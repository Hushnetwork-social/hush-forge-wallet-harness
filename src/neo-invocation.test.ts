import { describe, expect, it, vi } from "vitest";
import { loadForgeWalletHarnessConfig } from "./config.js";
import {
  buildContractParam,
  buildInvocationScript,
  normalizeInvocationRequest,
  normalizeNeoAccountToScriptHash,
  signAndSubmitNeoInvocation,
  type NeoInvocationRequest,
  type NeoRpcClientForSigning,
} from "./neo-invocation.js";

const GAS_CONTRACT_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";

describe("forge wallet harness Neo invocation core", () => {
  it("supports AppKit Address params as Hash160 contract params", () => {
    expect(
      buildContractParam({
        type: "Address",
        value: "NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c",
      }).toJson()
    ).toEqual({
      type: "Hash160",
      value: "88c48eaef7e64b646440da567cd85c9060efbf63",
    });
  });

  it("normalizes single NeoLine-style and multi AppKit-style invocations", () => {
    const single = normalizeInvocationRequest({
      args: [],
      operation: "symbol",
      scriptHash: GAS_CONTRACT_HASH,
      signers: [{ account: "0xabc", scopes: "CalledByEntry" }],
    });

    expect(single.invocations).toHaveLength(1);
    expect(single.signers).toEqual([
      { account: "0xabc", scopes: "CalledByEntry" },
    ]);

    const multi = normalizeInvocationRequest({
      invocations: [
        {
          args: [],
          operation: "symbol",
          scriptHash: GAS_CONTRACT_HASH,
        },
      ],
      signer: [{ scopes: "Global" }],
    });

    expect(multi.signers).toEqual([{ scopes: "Global" }]);
  });

  it("builds a Neo VM script for the normalized invocation", () => {
    const script = buildInvocationScript({
      args: [],
      operation: "symbol",
      scriptHash: GAS_CONTRACT_HASH,
    });

    expect(script).toEqual(expect.any(String));
    expect(script.length).toBeGreaterThan(0);
  });

  it("normalizes account addresses and script hashes for signer checks", () => {
    expect(
      normalizeNeoAccountToScriptHash("NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c")
    ).toBe("88c48eaef7e64b646440da567cd85c9060efbf63");
    expect(
      normalizeNeoAccountToScriptHash(
        "0x88C48EAEF7E64B646440DA567CD85C9060EFBF63"
      )
    ).toBe("88c48eaef7e64b646440da567cd85c9060efbf63");
  });

  it("signs and submits a normalized invocation through the supplied RPC client", async () => {
    const config = loadForgeWalletHarnessConfig({});
    const rpcClient = createRpcClient();

    const result = await signAndSubmitNeoInvocation({
      config,
      request: createSymbolRequest(config.account.address),
      rpcClient,
    });

    expect(result).toMatchObject({
      networkMagic: 5_195_086,
      nodeURL: "http://localhost:10332",
      txid: "0xtxid",
    });
    expect(result.signedTx).toEqual(expect.any(String));
    expect(rpcClient.invokeScript).toHaveBeenCalledTimes(1);
    expect(rpcClient.calculateNetworkFee).toHaveBeenCalledTimes(1);
    expect(rpcClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("signs with the harness account when the WalletConnect request omits signer account", async () => {
    const config = loadForgeWalletHarnessConfig({});
    const rpcClient = createRpcClient();

    const result = await signAndSubmitNeoInvocation({
      config,
      request: createSymbolRequestWithoutSigner(),
      rpcClient,
    });

    expect(result.txid).toBe("0xtxid");
    expect(rpcClient.invokeScript).toHaveBeenCalledWith(expect.anything(), [
      {
        account: config.account.scriptHash,
        scopes: "CalledByEntry",
      },
    ]);
  });

  it("rejects requests whose signer is not the harness account", async () => {
    const config = loadForgeWalletHarnessConfig({});
    const rpcClient = createRpcClient();

    await expect(
      signAndSubmitNeoInvocation({
        config,
        request: createSymbolRequest("0x1111111111111111111111111111111111111111"),
        rpcClient,
      })
    ).rejects.toThrow(/does not match harness account/);

    expect(rpcClient.getBlockCount).not.toHaveBeenCalled();
  });

  it("rejects signing when the RPC network magic is wrong", async () => {
    const config = loadForgeWalletHarnessConfig({});
    const rpcClient = createRpcClient({
      getVersion: vi.fn(async () => ({ protocol: { network: 860_833_102 } })),
    });

    await expect(
      signAndSubmitNeoInvocation({
        config,
        request: createSymbolRequest(config.account.address),
        rpcClient,
      })
    ).rejects.toThrow(/expected 5195086/);

    expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects dry-run faults before broadcasting", async () => {
    const config = loadForgeWalletHarnessConfig({});
    const rpcClient = createRpcClient({
      invokeScript: vi.fn(async () => ({
        exception: "contract fault",
        gasconsumed: "0",
        state: "FAULT",
      })),
    });

    await expect(
      signAndSubmitNeoInvocation({
        config,
        request: createSymbolRequest(config.account.address),
        rpcClient,
      })
    ).rejects.toThrow(/Dry-run faulted/);

    expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled();
  });
});

function createSymbolRequest(account: string): NeoInvocationRequest {
  return {
    args: [],
    operation: "symbol",
    scriptHash: GAS_CONTRACT_HASH,
    signers: [{ account, scopes: "CalledByEntry" }],
  };
}

function createSymbolRequestWithoutSigner(): NeoInvocationRequest {
  return {
    invocations: [
      {
        args: [],
        operation: "symbol",
        scriptHash: GAS_CONTRACT_HASH,
      },
    ],
  };
}

function createRpcClient(
  overrides: Partial<NeoRpcClientForSigning> = {}
): NeoRpcClientForSigning & {
  calculateNetworkFee: ReturnType<typeof vi.fn>;
  getBlockCount: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
  invokeScript: ReturnType<typeof vi.fn>;
  sendRawTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    calculateNetworkFee: vi.fn(async () => 200),
    getBlockCount: vi.fn(async () => 1_000),
    getVersion: vi.fn(async () => ({ protocol: { network: 5_195_086 } })),
    invokeScript: vi.fn(async () => ({
      gasconsumed: "1000",
      state: "HALT",
    })),
    sendRawTransaction: vi.fn(async () => "0xtxid"),
    ...overrides,
  };
}
