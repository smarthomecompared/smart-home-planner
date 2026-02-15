import process from "node:process";
import WebSocket from "ws";
import { createConnection } from "home-assistant-js-websocket";

globalThis.WebSocket = WebSocket;

const SUPERVISOR_WS_URL = "ws://supervisor/core/websocket";
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

function parseArgs(argv) {
  const args = { id: "", name: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--id") {
      args.id = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (token === "--name") {
      args.name = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
  }
  return args;
}

async function main() {
  const { id, name } = parseArgs(process.argv.slice(2));
  if (!id) {
    throw new Error("Missing required argument: --id");
  }
  if (!name) {
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
    const result = await conn.sendMessagePromise({
      type: "config/device_registry/update",
      device_id: id,
      name_by_user: name,
    });
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
