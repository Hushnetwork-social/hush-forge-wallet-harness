import { describe, expect, it } from "vitest";
import { loadForgeWalletHarnessConfig } from "./config.js";
import {
  buildHarnessWalletInfo,
  buildNeo3SessionNamespaces,
  toNeo3WalletConnectAccount,
} from "./session.js";

describe("forge wallet harness session namespace", () => {
  it("builds the Neo3 WalletConnect namespace expected by the CoZ adapter", () => {
    const config = loadForgeWalletHarnessConfig({});
    const namespaces = buildNeo3SessionNamespaces(config);

    expect(namespaces).toEqual({
      neo3: {
        accounts: [
          "neo3:private:NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c",
        ],
        chains: ["neo3:private"],
        events: [],
        methods: [
          "invokeFunction",
          "testInvoke",
          "signMessage",
          "verifyMessage",
          "getNetworkVersion",
          "getWalletInfo",
          "encrypt",
          "decrypt",
          "decryptFromArray",
          "calculateFee",
          "signTransaction",
        ],
      },
    });
  });

  it("can narrow methods for an early connection-only PoC", () => {
    const config = loadForgeWalletHarnessConfig({});
    const namespaces = buildNeo3SessionNamespaces(config, ["getWalletInfo"]);

    expect(namespaces.neo3.methods).toEqual(["getWalletInfo"]);
  });

  it("formats Neo3 WalletConnect account identifiers", () => {
    expect(
      toNeo3WalletConnectAccount(
        "neo3:private",
        "NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c"
      )
    ).toBe("neo3:private:NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c");
  });

  it("reports wallet info without pretending the harness is a hardware wallet", () => {
    const config = loadForgeWalletHarnessConfig({});

    expect(buildHarnessWalletInfo(config)).toMatchObject({
      address: "NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c",
      chainId: "neo3:private",
      expectedMagic: 5_195_086,
      isLedger: false,
      scriptHash: "88c48eaef7e64b646440da567cd85c9060efbf63",
    });
  });
});
