interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<TResult> {
  error?: JsonRpcError;
  result?: TResult;
}

interface NeoGetVersionResult {
  protocol?: {
    network?: number | string;
  };
}

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface AssertNeoNetworkMagicInput {
  expectedMagic: number;
  fetchImpl?: FetchLike;
  rpcUrl: string;
}

export async function assertNeoNetworkMagic({
  expectedMagic,
  fetchImpl,
  rpcUrl,
}: AssertNeoNetworkMagicInput): Promise<number> {
  const actualMagic = await fetchNeoNetworkMagic(rpcUrl, fetchImpl);

  if (actualMagic !== expectedMagic) {
    throw new Error(
      `Neo RPC ${rpcUrl} reported network magic ${actualMagic}; expected ${expectedMagic}.`
    );
  }

  return actualMagic;
}

export async function fetchNeoNetworkMagic(
  rpcUrl: string,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const response = await fetchImpl(rpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "getversion",
      params: [],
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Neo RPC ${rpcUrl} getversion failed with HTTP ${response.status}.`
    );
  }

  const payload = (await response.json()) as JsonRpcResponse<NeoGetVersionResult>;

  if (payload.error) {
    throw new Error(
      `Neo RPC ${rpcUrl} getversion failed: ${
        payload.error.message ?? payload.error.code ?? "unknown error"
      }.`
    );
  }

  const rawMagic = payload.result?.protocol?.network;
  const magic = typeof rawMagic === "string" ? Number(rawMagic) : rawMagic;

  if (typeof magic !== "number" || !Number.isSafeInteger(magic)) {
    throw new Error(`Neo RPC ${rpcUrl} did not return a valid network magic.`);
  }

  return magic;
}
