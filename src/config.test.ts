import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORGE_HARNESS_ADDRESS,
  DEFAULT_FORGE_HARNESS_SCRIPT_HASH,
  DEFAULT_NEO3_PRIVATE_NETWORK_MAGIC,
  DEFAULT_NEO3_PRIVATE_RPC_URL,
} from "./constants.js";
import {
  deriveHarnessAccount,
  loadForgeWalletHarnessConfig,
} from "./config.js";

describe("forge wallet harness config", () => {
  it("loads the standard neo3 private network defaults", () => {
    const config = loadForgeWalletHarnessConfig({});

    expect(config.rpcUrl).toBe(DEFAULT_NEO3_PRIVATE_RPC_URL);
    expect(config.chainId).toBe("neo3:private");
    expect(config.expectedMagic).toBe(DEFAULT_NEO3_PRIVATE_NETWORK_MAGIC);
    expect(config.account.address).toBe(DEFAULT_FORGE_HARNESS_ADDRESS);
    expect(config.account.scriptHash).toBe(DEFAULT_FORGE_HARNESS_SCRIPT_HASH);
    expect(config.projectId).toBe("");
  });

  it("uses a direct harness RPC URL before browser-facing RPC config", () => {
    const config = loadForgeWalletHarnessConfig({
      FORGE_WALLET_HARNESS_RPC_URL: "http://127.0.0.1:40332",
      NEXT_PUBLIC_NEO_RPC_URL: "/api/rpc",
    });

    expect(config.rpcUrl).toBe("http://127.0.0.1:40332");
  });

  it("ignores a browser proxy RPC URL because the wallet side needs direct RPC", () => {
    const config = loadForgeWalletHarnessConfig({
      NEXT_PUBLIC_NEO_RPC_URL: "/api/rpc",
    });

    expect(config.rpcUrl).toBe(DEFAULT_NEO3_PRIVATE_RPC_URL);
  });

  it("accepts custom WalletConnect runtime values", () => {
    const config = loadForgeWalletHarnessConfig({
      FORGE_WALLET_HARNESS_CHAIN_ID: "neo3:private",
      FORGE_WALLET_HARNESS_EXPECTED_MAGIC: "5195086",
      FORGE_WALLET_HARNESS_ICONS: "https://example.test/icon-a.png, https://example.test/icon-b.png",
      FORGE_WALLET_HARNESS_RELAY_URL: "wss://relay.example.test",
      FORGE_WALLET_HARNESS_REOWN_PROJECT_ID: "project-123",
    });

    expect(config.projectId).toBe("project-123");
    expect(config.relayUrl).toBe("wss://relay.example.test");
    expect(config.metadata.icons).toEqual([
      "https://example.test/icon-a.png",
      "https://example.test/icon-b.png",
    ]);
  });

  it("can require a Reown project id for the live WalletConnect runtime", () => {
    expect(() =>
      loadForgeWalletHarnessConfig({}, { requireProjectId: true })
    ).toThrow(/REOWN_PROJECT_ID/);
  });

  it("rejects invalid network magic config", () => {
    expect(() =>
      loadForgeWalletHarnessConfig({
        FORGE_WALLET_HARNESS_EXPECTED_MAGIC: "private",
      })
    ).toThrow(/positive integer/);
  });

  it("rejects an invalid WIF", () => {
    expect(() => deriveHarnessAccount("not-a-wif")).toThrow(
      /Invalid FORGE wallet harness WIF/
    );
  });
});
