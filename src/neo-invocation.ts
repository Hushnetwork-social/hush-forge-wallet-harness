import * as Neon from "@cityofzion/neon-js";
import type { ForgeWalletHarnessConfig } from "./config.js";

export interface NeoContractParam<TValue = unknown> {
  type: string;
  value?: TValue;
}

export interface NeoContractInvocation {
  abortOnFail?: boolean;
  args?: NeoContractParam[];
  operation: string;
  scriptHash: string;
}

export interface NeoWalletSigner {
  account?: string;
  scopes?: string;
}

export interface NeoContractInvocationMulti {
  invocations: NeoContractInvocation[];
  signer?: NeoWalletSigner[];
  signers?: NeoWalletSigner[];
}

export interface NeoSingleInvocationRequest extends NeoContractInvocation {
  signer?: NeoWalletSigner[];
  signers?: NeoWalletSigner[];
}

export type NeoInvocationRequest =
  | NeoContractInvocationMulti
  | NeoSingleInvocationRequest;

export interface NormalizedNeoInvocationRequest {
  invocations: NeoContractInvocation[];
  signers: NeoWalletSigner[];
}

export interface NeoRpcClientForSigning {
  calculateNetworkFee(transaction: unknown): Promise<number | string>;
  getBlockCount(): Promise<number>;
  getVersion(): Promise<{ protocol?: { network?: number | string } }>;
  invokeScript(
    script: unknown,
    signers?: unknown[]
  ): Promise<{ exception?: string; gasconsumed?: number | string; state?: string }>;
  sendRawTransaction(transaction: unknown): Promise<string>;
}

export interface SignAndSubmitNeoInvocationInput {
  config: ForgeWalletHarnessConfig;
  request: NeoInvocationRequest;
  rpcClient?: NeoRpcClientForSigning;
  systemFeeBufferRatio?: number;
  validUntilBlockOffset?: number;
}

export interface SignAndSubmitNeoInvocationResult {
  networkMagic: number;
  nodeURL: string;
  signedTx: string;
  txid: string;
}

type NeonContractParam = ReturnType<typeof Neon.sc.ContractParam.any>;

export function createNeoRpcClient(rpcUrl: string): NeoRpcClientForSigning {
  return new Neon.rpc.NeoServerRpcClient(
    rpcUrl
  ) as unknown as NeoRpcClientForSigning;
}

export function normalizeInvocationRequest(
  request: NeoInvocationRequest
): NormalizedNeoInvocationRequest {
  if ("invocations" in request) {
    return {
      invocations: request.invocations,
      signers: request.signers ?? request.signer ?? [],
    };
  }

  return {
    invocations: [
      {
        abortOnFail: request.abortOnFail,
        args: request.args,
        operation: request.operation,
        scriptHash: request.scriptHash,
      },
    ],
    signers: request.signers ?? request.signer ?? [],
  };
}

export function buildContractParam(param: NeoContractParam): NeonContractParam {
  switch (param.type) {
    case "Address":
      return Neon.sc.ContractParam.hash160(
        Neon.wallet.getScriptHashFromAddress(assertStringValue(param))
      );
    case "Hash160":
      return Neon.sc.ContractParam.hash160(assertStringValue(param));
    case "Integer":
      return Neon.sc.ContractParam.integer(param.value as number | string);
    case "String":
      return Neon.sc.ContractParam.string(assertStringValue(param));
    case "Boolean":
      return Neon.sc.ContractParam.boolean(param.value as boolean);
    case "ByteArray":
      return Neon.sc.ContractParam.byteArray(assertStringValue(param));
    case "Array":
      return Neon.sc.ContractParam.array(
        ...assertParamArrayValue(param).map(buildContractParam)
      );
    default:
      return Neon.sc.ContractParam.any(
        param.value as string | null | undefined
      );
  }
}

export function buildInvocationScript(request: NeoInvocationRequest): string {
  const normalized = normalizeInvocationRequest(request);
  const builder = new Neon.sc.ScriptBuilder();

  for (const invocation of normalized.invocations) {
    builder.emitContractCall({
      args: (invocation.args ?? []).map(buildContractParam),
      callFlags: Neon.sc.CallFlags.All,
      operation: invocation.operation,
      scriptHash: invocation.scriptHash,
    });
  }

  return builder.build();
}

export async function signAndSubmitNeoInvocation({
  config,
  request,
  rpcClient = createNeoRpcClient(config.rpcUrl),
  systemFeeBufferRatio = 1.1,
  validUntilBlockOffset = 200,
}: SignAndSubmitNeoInvocationInput): Promise<SignAndSubmitNeoInvocationResult> {
  const normalized = normalizeInvocationRequest(request);
  assertSignerMatchesHarnessAccount(config, normalized.signers[0]);

  const account = new Neon.wallet.Account(config.account.wif);
  const requestedScope = normalized.signers[0]?.scopes ?? "CalledByEntry";
  const signerScope = toWitnessScope(requestedScope);
  const signerAccount = Neon.u.HexString.fromHex(config.account.scriptHash);
  const script = buildInvocationScript(request);
  const currentHeight = await rpcClient.getBlockCount();
  const signer = new Neon.tx.Signer({
    account: signerAccount,
    scopes: signerScope,
  });
  const tx = new Neon.tx.Transaction({
    script: Neon.u.HexString.fromHex(script),
    signers: [signer],
    validUntilBlock: currentHeight + validUntilBlockOffset,
  });

  const dryRun = await rpcClient.invokeScript(Neon.u.HexString.fromHex(script), [
    {
      account: config.account.scriptHash,
      scopes: requestedScope,
    },
  ]);
  if (dryRun.state === "FAULT") {
    throw new Error(`Dry-run faulted: ${dryRun.exception ?? "unknown fault"}`);
  }

  tx.systemFee = Neon.u.BigInteger.fromNumber(
    calculateBufferedSystemFee(dryRun.gasconsumed, systemFeeBufferRatio)
  );

  const verificationScript = Neon.wallet.getVerificationScriptFromPublicKey(
    account.publicKey
  );
  tx.addWitness(
    new Neon.tx.Witness({
      invocationScript: "",
      verificationScript,
    })
  );
  tx.networkFee = Neon.u.BigInteger.fromDecimal(
    String(await rpcClient.calculateNetworkFee(tx)),
    0
  );

  const networkMagic = readExpectedNetworkMagic(
    await rpcClient.getVersion(),
    config.expectedMagic
  );

  tx.sign(account, networkMagic);

  const txid = await rpcClient.sendRawTransaction(tx);
  const signedTx = tx.serialize(true);

  return {
    networkMagic,
    nodeURL: config.rpcUrl,
    signedTx,
    txid,
  };
}

export function normalizeNeoAccountToScriptHash(account: string): string {
  const trimmed = account.trim();

  if (trimmed.startsWith("N")) {
    return Neon.wallet.getScriptHashFromAddress(trimmed).toLowerCase();
  }

  return trimmed.replace(/^0x/i, "").toLowerCase();
}

function assertSignerMatchesHarnessAccount(
  config: ForgeWalletHarnessConfig,
  signer: NeoWalletSigner | undefined
): void {
  if (!signer?.account) {
    return;
  }

  const requestedScriptHash = normalizeNeoAccountToScriptHash(signer.account);
  const harnessScriptHash = normalizeNeoAccountToScriptHash(
    config.account.scriptHash
  );

  if (requestedScriptHash !== harnessScriptHash) {
    throw new Error(
      `WalletConnect request signer ${signer.account} does not match harness account ${config.account.address}.`
    );
  }
}

function toWitnessScope(scope: string | undefined): number {
  switch (scope) {
    case "Global":
      return Neon.tx.WitnessScope.Global;
    case "None":
      return Neon.tx.WitnessScope.None;
    case "CalledByEntry":
    case undefined:
      return Neon.tx.WitnessScope.CalledByEntry;
    default:
      throw new Error(`Unsupported Neo witness scope: ${scope}`);
  }
}

function readExpectedNetworkMagic(
  version: { protocol?: { network?: number | string } },
  expectedMagic: number
): number {
  const rawMagic = version.protocol?.network;
  const magic = typeof rawMagic === "string" ? Number(rawMagic) : rawMagic;

  if (typeof magic !== "number" || !Number.isSafeInteger(magic)) {
    throw new Error("Neo RPC getversion did not include a valid network magic.");
  }

  if (magic !== expectedMagic) {
    throw new Error(
      `Neo RPC reported network magic ${magic}; expected ${expectedMagic}.`
    );
  }

  return magic;
}

function calculateBufferedSystemFee(
  gasConsumed: number | string | undefined,
  bufferRatio: number
): number {
  const parsed = Number(gasConsumed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Neo dry-run did not return a valid gasconsumed value.");
  }

  return Math.ceil(parsed * bufferRatio);
}

function assertStringValue(param: NeoContractParam): string {
  if (typeof param.value !== "string") {
    throw new Error(`${param.type} contract parameter requires a string value.`);
  }

  return param.value;
}

function assertParamArrayValue(param: NeoContractParam): NeoContractParam[] {
  if (!Array.isArray(param.value)) {
    throw new Error("Array contract parameter requires an array value.");
  }

  return param.value as NeoContractParam[];
}
