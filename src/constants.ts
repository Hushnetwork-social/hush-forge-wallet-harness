export const DEFAULT_NEO3_PRIVATE_CHAIN_ID = "neo3:private";
export const DEFAULT_NEO3_PRIVATE_NETWORK_MAGIC = 5_195_086;
export const DEFAULT_NEO3_PRIVATE_RPC_URL = "http://localhost:10332";

export const DEFAULT_FORGE_HARNESS_ADDRESS =
  "NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c";
export const DEFAULT_FORGE_HARNESS_WIF =
  "L3cNMQUSrvUrHx1MzacwHiUeCWzqK2MLt5fPvJj9mz6L2rzYZpok";
export const DEFAULT_FORGE_HARNESS_SCRIPT_HASH =
  "88c48eaef7e64b646440da567cd85c9060efbf63";

export const DEFAULT_WALLETCONNECT_RELAY_URL =
  "wss://relay.walletconnect.com";

export const NEO3_WALLETCONNECT_METHODS = [
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
] as const;

export type Neo3WalletConnectMethod =
  (typeof NEO3_WALLETCONNECT_METHODS)[number];

export const NEO3_WALLETCONNECT_EVENTS = [] as const;
