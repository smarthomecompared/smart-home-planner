import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { createConnection } from "home-assistant-js-websocket";

globalThis.WebSocket = WebSocket;

const SUPERVISOR_WS_URL = "ws://supervisor/core/websocket";
const DATA_DIR = "/data";
const STORAGE_FILE = path.join(DATA_DIR, "data.json");
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

const registries = [
  {
    name: "areas",
    command: "config/area_registry/list",
    event: "area_registry_updated",
    file: "areas.json",
  },
  {
    name: "floors",
    command: "config/floor_registry/list",
    event: "floor_registry_updated",
    file: "floors.json",
  },
  {
    name: "devices",
    command: "config/device_registry/list",
    event: "device_registry_updated",
    file: "devices.json",
  },
];

const registryQueue = new Map(registries.map((registry) => [registry.name, Promise.resolve()]));
const AUTO_EXCLUDED_DEVICE_MANUFACTURERS = new Set([
  "officialaddons",
  "homeassistant",
  "homeassistantcommunityapps",
  "localaddons",
  "tailscaleinc",
  "proxmoxve",
  "hacsxyz",
  "ping",
  "uptimekuma",
  "systemmonitor",
  "googlecastgroup",
  "googledrive",
  "musicassistant",
  "Zigbee2mqtt"
].map((value) => normalizeManufacturerKey(value)).filter(Boolean));
const AUTO_EXCLUDED_DEVICE_NAMES = new Set(["sun"].map((value) => normalizeString(value).toLowerCase()).filter(Boolean));
const AUTO_EXCLUDED_DEVICE_MODELS = new Set([
  "plugin",
  "integration",
  "alarmo",
  "forecast",
  "homeassistantapp",
  "jukeboxcontroller",
  "watchman",
  "googlecastgroup",
  "googledrive",
  "cloud",
].map((value) => normalizeModelKey(value)).filter(Boolean));
const AUTO_EXCLUDED_DEVICE_IDENTIFIER_NAMESPACES = new Set([
  "music_assistant",
  "google_weather"
].map((value) => normalizeString(value).toLowerCase()).filter(Boolean));
const REGISTRY_FIELDS_TO_OMIT = {
  devices: new Set([
    "config_entries",
    "config_entries_subentries",
    "created_at",
    "hw_version",
    "serial_number",
    "sw_version",
  ]),
  areas: new Set(["temperature_entity_id", "humidity_entity_id"]),
};

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeConnectionError(error) {
  if (error === 1) return "ERR_CANNOT_CONNECT";
  if (error === 2) return "ERR_INVALID_AUTH";
  if (typeof error === "number") return `ERROR_CODE_${error}`;
  if (error && typeof error === "object" && "message" in error) {
    return error.message || String(error);
  }
  return String(error);
}

async function retry(fn, label, options = {}) {
  const initialDelay = options.initialDelay ?? 2000;
  const maxDelay = options.maxDelay ?? 30000;
  const factor = options.factor ?? 2;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const errorMessage = error?.message || String(error);
      log(`${label} failed: ${errorMessage}. Retrying in ${delay}ms...`);
      await wait(delay);
      delay = Math.min(maxDelay, Math.floor(delay * factor));
    }
  }
}

async function saveToData(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, file);
  const temp = `${target}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, target);
}

function omitFieldsFromObject(source, fieldsToOmit) {
  if (!source || typeof source !== "object") return source;
  if (!fieldsToOmit || fieldsToOmit.size === 0) return source;
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    if (fieldsToOmit.has(key)) continue;
    next[key] = value;
  }
  return next;
}

function sanitizeRegistryDataForFile(registryName, data) {
  const fieldsToOmit = REGISTRY_FIELDS_TO_OMIT[registryName];
  if (!fieldsToOmit || !Array.isArray(data)) return data;
  return data.map((item) => omitFieldsFromObject(item, fieldsToOmit));
}

async function readStorageJson() {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeStorageJson(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${STORAGE_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temp, STORAGE_FILE);
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeManufacturerKey(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeModelKey(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeBrand(value) {
  const raw = normalizeString(value);
  if (!raw) return "";
  const key = normalizeManufacturerKey(raw);
  if (key === "googleinc" || key === "googlenest") {
    return "Google";
  }
  if (key === "raspberrypitradingltd") {
    return "Raspberry Pi";
  }
  return raw;
}

function shouldAutoExcludeOnCreate(haDevice) {
  const disabledBy = normalizeString(haDevice?.disabled_by).toLowerCase();
  if (disabledBy === "user" || disabledBy === "config_entry") {
    return true;
  }
  const identifiers = Array.isArray(haDevice?.identifiers) ? haDevice.identifiers : [];
  const hasExcludedIdentifierNamespace = identifiers.some(
    (entry) =>
      Array.isArray(entry) &&
      AUTO_EXCLUDED_DEVICE_IDENTIFIER_NAMESPACES.has(normalizeString(entry[0]).toLowerCase())
  );
  if (hasExcludedIdentifierNamespace) {
    return true;
  }
  const manufacturerKey = normalizeManufacturerKey(haDevice?.manufacturer);
  if (AUTO_EXCLUDED_DEVICE_MANUFACTURERS.has(manufacturerKey)) {
    return true;
  }
  const modelKey = normalizeModelKey(haDevice?.model);
  if (AUTO_EXCLUDED_DEVICE_MODELS.has(modelKey)) {
    return true;
  }
  const rawName = normalizeString(haDevice?.name_by_user) || normalizeString(haDevice?.name);
  const nameKey = rawName.toLowerCase();
  return AUTO_EXCLUDED_DEVICE_NAMES.has(nameKey);
}

function pickDeviceName(device) {
  return (
    normalizeString(device?.name_by_user) ||
    normalizeString(device?.name) ||
    normalizeString(device?.id)
  );
}

function getHaAreaSyncTarget(settings) {
  if (settings && settings.haAreaSyncTarget === "installed") {
    return "installed";
  }
  return "controlled";
}

function getExcludedDeviceIds(storage) {
  const source = Array.isArray(storage?.excluded_devices)
    ? storage.excluded_devices
    : Array.isArray(storage?.excludedDevices)
      ? storage.excludedDevices
      : [];
  return new Set(source.map((value) => normalizeString(value)).filter(Boolean));
}

function buildSyncedDevice(haDevice, existingDevice, haAreaSyncTarget) {
  const id = normalizeString(haDevice?.id);
  const areaId = normalizeString(haDevice?.area_id);
  const manufacturer = normalizeBrand(haDevice?.manufacturer);
  const model = normalizeString(haDevice?.model);
  const hasExistingDevice = Boolean(existingDevice && typeof existingDevice === "object");
  const base = hasExistingDevice ? { ...existingDevice } : {};

  const synced = {
    ...base,
    id,
    name: pickDeviceName(haDevice) || normalizeString(base.name) || id,
    brand: hasExistingDevice ? normalizeString(base.brand) : manufacturer,
    model: hasExistingDevice ? normalizeString(base.model) : model,
    homeAssistant: true,
  };

  if (!hasExistingDevice) {
    synced.status = "working";
    synced.area = areaId;
    synced.controlledArea = areaId;
  } else if (haAreaSyncTarget === "controlled") {
    synced.controlledArea = areaId;
  } else {
    synced.area = areaId;
  }

  delete synced.createdAt;
  return synced;
}

async function syncStorageDevicesFromRegistry(haDevices) {
  const storage = await readStorageJson();
  const haAreaSyncTarget = getHaAreaSyncTarget(storage.settings);
  const excludedDeviceIds = getExcludedDeviceIds(storage);
  const existingDevices = Array.isArray(storage.devices) ? storage.devices : [];
  const existingById = new Map(
    existingDevices
      .filter((device) => device && typeof device === "object")
      .map((device) => [normalizeString(device.id), device])
      .filter(([id]) => Boolean(id))
  );

  const sourceDevices = (haDevices || []).filter((device) => device && typeof device === "object");
  const sourceDevicesAfterExclusions = [];
  const autoExcludedOnCreateIds = new Set();
  let excludedDevicesCount = 0;

  for (const sourceDevice of sourceDevices) {
    const id = normalizeString(sourceDevice?.id);
    if (!id) continue;

    // Existing devices are never auto-excluded by sync rules.
    if (existingById.has(id)) {
      sourceDevicesAfterExclusions.push(sourceDevice);
      continue;
    }

    if (excludedDeviceIds.has(id)) {
      excludedDevicesCount += 1;
      continue;
    }

    if (shouldAutoExcludeOnCreate(sourceDevice)) {
      autoExcludedOnCreateIds.add(id);
      excludedDevicesCount += 1;
      continue;
    }

    sourceDevicesAfterExclusions.push(sourceDevice);
  }

  const sourceById = new Map(
    sourceDevicesAfterExclusions
      .map((device) => [normalizeString(device?.id), device])
      .filter(([id, device]) => Boolean(id) && Boolean(device))
  );

  const syncedIds = new Set();
  const nextDevices = [];
  let unlinkedDevicesCount = 0;
  let createdDevicesCount = 0;

  for (const existingDevice of existingDevices) {
    if (!existingDevice || typeof existingDevice !== "object") {
      continue;
    }
    const id = normalizeString(existingDevice.id);
    if (!id) {
      nextDevices.push(existingDevice);
      continue;
    }

    const sourceDevice = sourceById.get(id);
    if (sourceDevice) {
      nextDevices.push(buildSyncedDevice(sourceDevice, existingDevice, haAreaSyncTarget));
      syncedIds.add(id);
      continue;
    }

    const wasLinkedToHa = Boolean(existingDevice.homeAssistant);
    const retainedDevice = {
      ...existingDevice,
      homeAssistant: false,
    };
    nextDevices.push(retainedDevice);
    if (wasLinkedToHa) {
      unlinkedDevicesCount += 1;
    }
  }

  for (const sourceDevice of sourceDevicesAfterExclusions) {
    const id = normalizeString(sourceDevice?.id);
    if (!id || syncedIds.has(id)) continue;
    nextDevices.push(buildSyncedDevice(sourceDevice, existingById.get(id), haAreaSyncTarget));
    createdDevicesCount += 1;
  }

  const nextExcludedDevices = [...excludedDeviceIds];
  for (const id of autoExcludedOnCreateIds) {
    if (excludedDeviceIds.has(id)) continue;
    excludedDeviceIds.add(id);
    nextExcludedDevices.push(id);
  }

  const nextStorage = {
    ...storage,
    devices: nextDevices,
    excluded_devices: nextExcludedDevices,
  };

  await writeStorageJson(nextStorage);
  log(`data.json devices synced (${nextDevices.length})`);
  log(`Home Assistant area sync target: ${haAreaSyncTarget}`);
  if (excludedDevicesCount > 0) {
    log(`Ignored ${excludedDevicesCount} device(s) by excluded_devices.`);
  }
  if (autoExcludedOnCreateIds.size > 0) {
    log(`Auto-excluded ${autoExcludedOnCreateIds.size} new device(s) by sync exclusion rules.`);
  }
  if (unlinkedDevicesCount > 0) {
    log(
      `Marked ${unlinkedDevicesCount} device(s) as unlinked from Home Assistant (homeAssistant=false).`
    );
  }
  if (createdDevicesCount > 0) {
    log(`Created ${createdDevicesCount} new device(s) from Home Assistant.`);
  }
}

async function fetchRegistry(conn, registry) {
  const data = await conn.sendMessagePromise({ type: registry.command });
  if (!Array.isArray(data)) {
    throw new Error(`Invalid response for ${registry.command}`);
  }
  return data;
}

async function syncRegistry(conn, registry, reason = "manual") {
  const data = await fetchRegistry(conn, registry);
  const sanitizedData = sanitizeRegistryDataForFile(registry.name, data);
  await saveToData(registry.file, sanitizedData);
  if (registry.name === "devices") {
    await syncStorageDevicesFromRegistry(data);
  }

  if (registry.name === "areas") {
    log(`Areas synced (${data.length})`);
  } else if (registry.name === "floors") {
    log(`Floors synced (${data.length})`);
  } else if (registry.name === "devices") {
    log(`Devices synced (${data.length})`);
  } else {
    log(`${registry.name} synced (${data.length})`);
  }
  log(`${registry.name}: sync completed (reason: ${reason})`);
}

function enqueueRegistrySync(conn, registry, reason) {
  const previous = registryQueue.get(registry.name) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => retry(() => syncRegistry(conn, registry, reason), `Sync ${registry.name}`));
  registryQueue.set(registry.name, next);
  return next;
}

async function syncAll(conn, reason = "startup") {
  await Promise.all(
    registries.map((registry) =>
      retry(() => syncRegistry(conn, registry, reason), `Initial sync ${registry.name}`)
    )
  );
}

async function subscribeToUpdates(conn) {
  for (const registry of registries) {
    await retry(
      async () => {
        await conn.subscribeEvents((eventPayload) => {
          const eventType = eventPayload?.event_type || registry.event;
          log(`Event received: ${eventType}`);
          if (eventType === "area_registry_updated") {
            log("Area Registry updated -> re-syncing");
          }
          if (eventType === "floor_registry_updated") {
            log("Floor Registry updated -> re-syncing");
          }
          if (eventType === "device_registry_updated") {
            log("Device Registry updated -> re-syncing");
          }
          enqueueRegistrySync(conn, registry, `event ${eventType}`);
        }, registry.event);
      },
      `Subscription ${registry.event}`
    );
    log(`Active subscription: ${registry.event}`);
  }
}

async function connectAndRun() {
  const token = (SUPERVISOR_TOKEN || "").trim();
  if (!token) {
    throw new Error("SUPERVISOR_TOKEN is not defined.");
  }

  const auth = {
    wsUrl: SUPERVISOR_WS_URL,
    accessToken: token,
    expired: false,
    refreshAccessToken: async () => {
      auth.accessToken = token;
      auth.expired = false;
    },
  };

  log(`Connecting to Home Assistant WebSocket: ${SUPERVISOR_WS_URL}`);
  const conn = await createConnection({
    auth,
    setupRetry: -1,
  });

  log("Connection and authentication successful.");

  conn.addEventListener("ready", () => {
    log("WebSocket connection ready. Re-syncing registries...");
    for (const registry of registries) {
      enqueueRegistrySync(conn, registry, "ready");
    }
  });

  conn.addEventListener("disconnected", () => {
    log("WebSocket disconnected. The library will retry automatically.");
  });

  conn.addEventListener("reconnect-error", (event) => {
    const details = event?.data || "";
    log(`WebSocket reconnect error: ${details}`);
  });

  await syncAll(conn, "startup");
  await subscribeToUpdates(conn);

  log("Sync worker started and listening for events.");
  return conn;
}

async function main() {
  while (true) {
    try {
      const conn = await connectAndRun();
      await new Promise((resolve) => {
        process.once("SIGTERM", resolve);
        process.once("SIGINT", resolve);
      });
      await conn.close();
      process.exit(0);
    } catch (error) {
      const errorMessage = describeConnectionError(error);
      log(`Sync worker failed: ${errorMessage}`);
      if (error === 2) {
        log("Authentication was rejected by Home Assistant. Verify SUPERVISOR_TOKEN permissions and validity.");
      } else if (error === 1) {
        log("Cannot connect to ws://supervisor/core/websocket. Verify add-on API permissions/network.");
      }
      log("Retrying main connection in 10 seconds...");
      await wait(10000);
    }
  }
}

main().catch((error) => {
  const errorMessage = error?.message || String(error);
  log(`Error fatal: ${errorMessage}`);
  process.exit(1);
});
