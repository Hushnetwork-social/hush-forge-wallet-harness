#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  loadForgeWalletHarnessConfig,
  startLocalWalletConnectRelay,
  startWalletConnectHarnessRuntime,
} from "./index.js";

const DEFAULT_PAIR_PORT = 32103;
const DEFAULT_RELAY_PORT = 32102;
const DEFAULT_PROJECT_ID = "forge-local-project";
const DEFAULT_RPC_URL = "http://127.0.0.1:10332";

const relayPort = readPort(
  process.env.FORGE_WALLET_HARNESS_RELAY_PORT,
  DEFAULT_RELAY_PORT
);
const pairPort = readPort(
  process.env.FORGE_WALLET_HARNESS_PAIR_PORT,
  DEFAULT_PAIR_PORT
);

void main();

async function main(): Promise<void> {
  const relay = await startLocalWalletConnectRelay(relayPort);
  const harnessConfig = loadForgeWalletHarnessConfig(
    {
      ...process.env,
      FORGE_WALLET_HARNESS_RELAY_URL: relay.url,
      FORGE_WALLET_HARNESS_REOWN_PROJECT_ID:
        process.env.FORGE_WALLET_HARNESS_REOWN_PROJECT_ID ??
        process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ??
        DEFAULT_PROJECT_ID,
      FORGE_WALLET_HARNESS_RPC_URL:
        process.env.FORGE_WALLET_HARNESS_RPC_URL ??
        process.env.E2E_NEO_RPC_URL ??
        DEFAULT_RPC_URL,
    },
    { requireProjectId: true }
  );
  const runtime = await startWalletConnectHarnessRuntime(harnessConfig, {
    projectId: harnessConfig.projectId,
    relayUrl: harnessConfig.relayUrl,
    storagePrefix: `forge-wallet-harness-dev-${Date.now()}`,
  });

  const server = createServer((request, response) => {
    void handleRequest(request, response, runtime, harnessConfig, relay.url);
  });

  await new Promise<void>((resolve) => server.listen(pairPort, resolve));

  console.log("[forge-wallet-harness] relay:", relay.url);
  console.log(
    "[forge-wallet-harness] pair endpoint:",
    `http://127.0.0.1:${pairPort}/pair`
  );
  console.log("[forge-wallet-harness] account:", harnessConfig.account.address);
  console.log("[forge-wallet-harness] rpc:", harnessConfig.rpcUrl);

  async function shutdown(): Promise<void> {
    await runtime.close().catch(() => undefined);
    await relay.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  }

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Awaited<ReturnType<typeof startWalletConnectHarnessRuntime>>,
  harnessConfig: ReturnType<typeof loadForgeWalletHarnessConfig>,
  relayUrl: string
): Promise<void> {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      account: harnessConfig.account.address,
      ok: true,
      relayUrl,
      rpcUrl: harnessConfig.rpcUrl,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/pair") {
    const body = (await readJsonBody(request)) as { uri?: unknown };
    if (typeof body.uri !== "string" || !body.uri.startsWith("wc:")) {
      writeJson(response, 400, { error: "Missing WalletConnect URI." });
      return;
    }

    await runtime.pair(body.uri);
    writeJson(response, 200, { ok: true });
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Origin", "*");
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}
