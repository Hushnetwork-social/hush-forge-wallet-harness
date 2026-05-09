// @vitest-environment node

import UniversalProvider from "@walletconnect/universal-provider";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { loadForgeWalletHarnessConfig } from "./config.js";
import {
  NEO3_WALLETCONNECT_EVENTS,
  NEO3_WALLETCONNECT_METHODS,
} from "./constants.js";
import {
  type LocalWalletConnectRelay,
  startLocalWalletConnectRelay,
} from "./local-relay.js";
import {
  type WalletConnectHarnessRuntime,
  startWalletConnectHarnessRuntime,
} from "./walletconnect-runtime.js";

describe("walletconnect harness runtime", () => {
  let relay: LocalWalletConnectRelay | null = null;
  let runtime: WalletConnectHarnessRuntime | null = null;

  afterEach(async () => {
    await runtime?.close();
    await relay?.close();
    runtime = null;
    relay = null;
  });

  it("pairs through the local relay and records wallet requests", async () => {
    relay = await startLocalWalletConnectRelay(0);
    const config = loadForgeWalletHarnessConfig({
      FORGE_WALLET_HARNESS_RELAY_URL: relay.url,
      FORGE_WALLET_HARNESS_REOWN_PROJECT_ID: "forge-local-project",
    });
    runtime = await startWalletConnectHarnessRuntime(config, {
      projectId: config.projectId,
      relayUrl: relay.url,
      storagePrefix: `forge-walletkit-test-${Date.now()}`,
    });
    const provider = await UniversalProvider.init({
      disableProviderPing: true,
      projectId: config.projectId,
      relayUrl: relay.url,
    });

    provider.on("display_uri", (uri: string) => {
      void runtime?.pair(uri);
    });

    await provider.connect({
      optionalNamespaces: {
        neo3: {
          chains: [config.chainId],
          events: [...NEO3_WALLETCONNECT_EVENTS],
          methods: [...NEO3_WALLETCONNECT_METHODS],
        },
      },
    });

    const walletInfo = await provider.request(
      { method: "getWalletInfo", params: [] },
      config.chainId
    );
    const networkVersion = await provider.request(
      { method: "getNetworkVersion", params: [] },
      config.chainId
    );

    expect(walletInfo).toMatchObject({
      address: config.account.address,
      chainId: config.chainId,
      expectedMagic: config.expectedMagic,
      isLedger: false,
      rpcUrl: config.rpcUrl,
      scriptHash: config.account.scriptHash,
    });
    expect(networkVersion).toMatchObject({
      protocol: {
        network: config.expectedMagic,
      },
      rpcAddress: config.rpcUrl,
    });
    expect(runtime.listRequests()).toEqual([
      expect.objectContaining({
        method: "getWalletInfo",
        status: "approved",
        topic: expect.any(String),
      }),
      expect.objectContaining({
        method: "getNetworkVersion",
        result: expect.objectContaining({
          protocol: { network: config.expectedMagic },
        }),
        status: "approved",
        topic: expect.any(String),
      }),
    ]);
  }, 30_000);

  it("preserves large Android JSON-RPC ids in relay acknowledgements", async () => {
    relay = await startLocalWalletConnectRelay(0);
    const socket = new WebSocket(relay.url);
    await waitForSocketOpen(socket);

    const androidStyleId = "1778341964282845123";
    const messagePromise = waitForSocketMessage(socket);
    socket.send(
      `{"id":${androidStyleId},"jsonrpc":"2.0","method":"wc_proposeSession","params":{"pairingTopic":"topic","sessionProposal":"proposal"}}`
    );

    const raw = await messagePromise;
    expect(raw).toContain(`"id":${androidStyleId}`);
    expect(JSON.parse(raw)).toMatchObject({
      jsonrpc: "2.0",
      result: true,
    });

    socket.close();
  });

  it("delivers session approval on the subscribed pairing topic", async () => {
    relay = await startLocalWalletConnectRelay(0);
    const dapp = new WebSocket(relay.url);
    const wallet = new WebSocket(relay.url);
    await Promise.all([waitForSocketOpen(dapp), waitForSocketOpen(wallet)]);

    const pairingTopic = "pairing-topic";
    const subscribePromise = waitForSocketMessage(dapp);
    dapp.send(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "irn_subscribe",
        params: { topic: pairingTopic },
      })
    );
    const subscriptionId = JSON.parse(await subscribePromise).result;

    const proposePromise = waitForSocketMessage(dapp);
    dapp.send(
      JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "wc_proposeSession",
        params: {
          pairingTopic,
          sessionProposal: "proposal",
        },
      })
    );
    expect(JSON.parse(await proposePromise)).toMatchObject({ result: true });

    const approvalPromise = waitForSocketMessage(dapp);
    wallet.send(
      JSON.stringify({
        id: 3,
        jsonrpc: "2.0",
        method: "wc_approveSession",
        params: {
          pairingTopic,
          sessionProposalResponse: "approved",
          sessionSettlementRequest: "settled",
          sessionTopic: "session-topic",
        },
      })
    );

    const approval = JSON.parse(await approvalPromise);
    expect(approval).toMatchObject({
      method: "irn_subscription",
      params: {
        data: {
          message: "approved",
          tag: 0,
          topic: pairingTopic,
        },
        id: subscriptionId,
        subscriptionData: {
          message: "approved",
          tag: 0,
          topic: pairingTopic,
        },
        subscriptionId,
      },
    });

    dapp.close();
    wallet.close();
  });

  it("uses the Android Reown relay shape for batch subscriptions", async () => {
    relay = await startLocalWalletConnectRelay(0);
    const dapp = new WebSocket(relay.url);
    const wallet = new WebSocket(relay.url);
    await Promise.all([waitForSocketOpen(dapp), waitForSocketOpen(wallet)]);

    const pairingTopic = "android-pairing-topic";
    const subscribePromise = waitForSocketMessage(dapp);
    dapp.send(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "irn_batchSubscribe",
        params: { topics: [pairingTopic] },
      })
    );

    const subscriptionIds = JSON.parse(await subscribePromise).result;
    expect(subscriptionIds).toEqual([expect.any(String)]);

    const proposePromise = waitForSocketMessage(dapp);
    dapp.send(
      JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "wc_proposeSession",
        params: {
          pairingTopic,
          sessionProposal: "proposal",
        },
      })
    );
    expect(JSON.parse(await proposePromise)).toMatchObject({ result: true });

    const approvalPromise = waitForSocketMessage(dapp);
    wallet.send(
      JSON.stringify({
        id: 3,
        jsonrpc: "2.0",
        method: "wc_approveSession",
        params: {
          pairingTopic,
          sessionProposalResponse: "approved",
          sessionSettlementRequest: "settled",
          sessionTopic: "session-topic",
        },
      })
    );

    const approval = JSON.parse(await approvalPromise);
    expect(approval).toMatchObject({
      method: "irn_subscription",
      params: {
        subscriptionData: {
          message: "approved",
          publishedAt: expect.any(Number),
          tag: 0,
          topic: pairingTopic,
        },
        subscriptionId: subscriptionIds[0],
      },
    });

    dapp.close();
    wallet.close();
  });
});

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForSocketMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(data.toString()));
    socket.once("error", reject);
  });
}
