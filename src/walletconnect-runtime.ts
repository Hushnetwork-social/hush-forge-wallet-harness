import { Core } from "@walletconnect/core";
import {
  formatJsonRpcError,
  formatJsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";
import type { ForgeWalletHarnessConfig } from "./config.js";
import {
  buildHarnessWalletInfo,
  buildNeo3SessionNamespaces,
} from "./session.js";
import {
  signAndSubmitNeoInvocation,
  type NeoInvocationRequest,
} from "./neo-invocation.js";
import {
  WalletConnectRequestStore,
  type WalletConnectHarnessRequest,
} from "./request-store.js";

export interface WalletConnectHarnessRuntimeOptions {
  projectId: string;
  relayUrl: string;
  storagePrefix?: string;
}

export interface WalletConnectHarnessRuntime {
  close(): Promise<void>;
  listRequests(): WalletConnectHarnessRequest[];
  pair(uri: string): Promise<void>;
}

export async function startWalletConnectHarnessRuntime(
  config: ForgeWalletHarnessConfig,
  options: WalletConnectHarnessRuntimeOptions
): Promise<WalletConnectHarnessRuntime> {
  const core = new Core({
    customStoragePrefix:
      options.storagePrefix ?? `forge-wallet-harness-${Date.now()}`,
    projectId: options.projectId,
    relayUrl: options.relayUrl,
  });
  const walletKit = await WalletKit.init({
    core,
    metadata: {
      description: "FORGE WalletConnect test wallet harness.",
      icons: [],
      name: config.metadata.name,
      url: config.metadata.url,
    },
  });
  const requestStore = new WalletConnectRequestStore();

  walletKit.on("session_proposal", async (proposal) => {
    await walletKit.approveSession({
      id: proposal.id,
      namespaces: buildNeo3SessionNamespaces(config),
    });
  });

  walletKit.on("session_request", async (event) => {
    await handleSessionRequest(walletKit, config, event, requestStore);
  });

  return {
    close: async () => {
      const sessions = Object.values(walletKit.getActiveSessions());
      await Promise.all(
        sessions.map((session) =>
          walletKit
            .disconnectSession({
              reason: {
                code: 6000,
                message: "FORGE wallet harness closed.",
              },
              topic: session.topic,
            })
            .catch(() => undefined)
        )
      );
    },
    listRequests: () => requestStore.list(),
    pair: (uri: string) => walletKit.pair({ uri }),
  };
}

async function handleSessionRequest(
  walletKit: Awaited<ReturnType<typeof WalletKit.init>>,
  config: ForgeWalletHarnessConfig,
  event: WalletKitTypes.SessionRequest,
  requestStore: WalletConnectRequestStore
): Promise<void> {
  const { id, topic, params } = event;
  const { request } = params;
  const capturedRequest = requestStore.capture({
    method: request.method,
    params: request.params,
    requestId: id,
    topic,
  });

  try {
    if (request.method === "invokeFunction") {
      const result = await signAndSubmitNeoInvocation({
        config,
        request: request.params as NeoInvocationRequest,
      });
      requestStore.approve(capturedRequest.id, result);
      await walletKit.respondSessionRequest({
        response: formatJsonRpcResult(id, result.txid),
        topic,
      });
      return;
    }

    if (request.method === "getNetworkVersion") {
      const result = {
        protocol: {
          network: config.expectedMagic,
        },
        rpcAddress: config.rpcUrl,
      };
      requestStore.approve(capturedRequest.id, result);
      await walletKit.respondSessionRequest({
        response: formatJsonRpcResult(id, result),
        topic,
      });
      return;
    }

    if (request.method === "getWalletInfo") {
      const result = buildHarnessWalletInfo(config);
      requestStore.approve(capturedRequest.id, result);
      await walletKit.respondSessionRequest({
        response: formatJsonRpcResult(id, result),
        topic,
      });
      return;
    }

    requestStore.reject(
      capturedRequest.id,
      `FORGE wallet harness does not implement ${request.method}.`
    );
    await walletKit.respondSessionRequest({
      response: formatJsonRpcError(
        id,
        `FORGE wallet harness does not implement ${request.method}.`
      ),
      topic,
    });
  } catch (error) {
    requestStore.fail(
      capturedRequest.id,
      error instanceof Error ? error.message : String(error)
    );
    await walletKit.respondSessionRequest({
      response: formatJsonRpcError(
        id,
        error instanceof Error ? error.message : String(error)
      ),
      topic,
    });
  }
}
