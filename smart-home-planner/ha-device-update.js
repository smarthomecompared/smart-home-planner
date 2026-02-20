import process from "node:process";
import WebSocket from "ws";
import { createConnection } from "home-assistant-js-websocket";

globalThis.WebSocket = WebSocket;

const SUPERVISOR_WS_URL = "ws://supervisor/core/websocket";
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

function parseArgs(argv) {
  const args = {
    id: "",
    name: "",
    areaId: "",
    labels: [],
    hasName: false,
    hasAreaId: false,
    hasLabels: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--id") {
      args.id = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (token === "--name") {
      args.name = String(argv[index + 1] || "").trim();
      args.hasName = true;
      index += 1;
      continue;
    }
    if (token === "--area-id") {
      args.areaId = String(argv[index + 1] || "").trim();
      args.hasAreaId = true;
      index += 1;
      continue;
    }
    if (token === "--labels") {
      const rawLabels = String(argv[index + 1] || "").trim();
      args.hasLabels = true;
      index += 1;
      if (!rawLabels) {
        args.labels = [];
        continue;
      }
      try {
        const parsed = JSON.parse(rawLabels);
        if (Array.isArray(parsed)) {
          args.labels = parsed.map((value) => String(value || "").trim()).filter(Boolean);
        } else {
          args.labels = [];
        }
      } catch (_error) {
        args.labels = rawLabels
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean);
      }
      continue;
    }
  }
  return args;
}

async function main() {
  const { id, name, areaId, labels, hasName, hasAreaId, hasLabels } = parseArgs(process.argv.slice(2));
  if (!id) {
    throw new Error("Missing required argument: --id");
  }
  if (!hasName && !hasAreaId && !hasLabels) {
    throw new Error("Missing required argument: --name, --area-id, or --labels");
  }
  if (hasName && !name) {
    throw new Error("Missing required argument: --name");
  }

  const token = String(SUPERVISOR_TOKEN || "").trim();
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

  const conn = await createConnection({
    auth,
    setupRetry: 0,
  });

  try {
    const payload = {
      type: "config/device_registry/update",
      device_id: id,
    };
    if (hasName) {
      payload.name_by_user = name;
    }
    if (hasAreaId) {
      payload.area_id = areaId || null;
    }
    if (hasLabels) {
      payload.labels = Array.isArray(labels) ? labels : [];
    }
    const result = await conn.sendMessagePromise(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  const message = error?.message || String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
