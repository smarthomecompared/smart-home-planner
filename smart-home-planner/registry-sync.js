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
const BLOCKED_DEVICE_MANUFACTURERS = new Set([
  "officialaddons",
  "homeassistant",
  "homeassistantcommunityapps",
  "localaddons",
  "tailscaleinc",
  "proxmoxve",
]);
const BLOCKED_DEVICE_NAMES = new Set(["sun"]);
const BLOCKED_DEVICE_MODELS = new Set([
  "plugin",
  "integration",
  "alarmo",
  "forecast",
  "homeassistantapp",
  "jukeboxcontroller",
  "watchman",
]);

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
  if (key === "googleinc") {
    return "Google";
  }
  return raw;
}

function shouldSkipDevice(haDevice) {
  const manufacturerKey = normalizeManufacturerKey(haDevice?.manufacturer);
  if (BLOCKED_DEVICE_MANUFACTURERS.has(manufacturerKey)) {
    return true;
  }
  const modelKey = normalizeModelKey(haDevice?.model);
  if (BLOCKED_DEVICE_MODELS.has(modelKey)) {
    return true;
  }
  const rawName = normalizeString(haDevice?.name_by_user) || normalizeString(haDevice?.name);
  const nameKey = rawName.toLowerCase();
  return BLOCKED_DEVICE_NAMES.has(nameKey);
}

function pickDeviceName(device) {
  return (
    normalizeString(device?.name_by_user) ||
    normalizeString(device?.name) ||
    normalizeString(device?.id)
  );
}

function getHaAreaSyncTarget(settings) {
  if (settings && settings.haAreaSyncTarget === "controlled") {
    return "controlled";
  }
  return "installed";
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
    brand: manufacturer || normalizeString(base.brand),
    model: model || normalizeString(base.model),
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
  const filteredSourceDevices = sourceDevices.filter((device) => !shouldSkipDevice(device));
  const ignoredDevicesCount = sourceDevices.length - filteredSourceDevices.length;
  const sourceDevicesAfterExclusions = filteredSourceDevices.filter(
    (device) => !excludedDeviceIds.has(normalizeString(device.id))
  );
  const excludedDevicesCount = filteredSourceDevices.length - sourceDevicesAfterExclusions.length;

  const nextDevices = sourceDevicesAfterExclusions
    .map((device) => {
      const id = normalizeString(device.id);
      if (!id) return null;
      return buildSyncedDevice(device, existingById.get(id), haAreaSyncTarget);
    })
    .filter(Boolean);

  const nextStorage = {
    ...storage,
    devices: nextDevices,
  };

  await writeStorageJson(nextStorage);
  log(`data.json devices synced (${nextDevices.length})`);
  log(`Home Assistant area sync target: ${haAreaSyncTarget}`);
  if (ignoredDevicesCount > 0) {
    log(`Ignored ${ignoredDevicesCount} device(s) by sync filters.`);
  }
  if (excludedDevicesCount > 0) {
    log(`Ignored ${excludedDevicesCount} device(s) by excluded_devices.`);
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
  await saveToData(registry.file, data);
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
