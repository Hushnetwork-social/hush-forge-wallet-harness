import {
  NEO3_WALLETCONNECT_EVENTS,
  NEO3_WALLETCONNECT_METHODS,
  type Neo3WalletConnectMethod,
} from "./constants.js";
import type { ForgeWalletHarnessConfig } from "./config.js";

export interface WalletConnectSessionNamespace {
  accounts: string[];
  chains: string[];
  events: string[];
  methods: string[];
}

export type WalletConnectSessionNamespaces = Record<
  string,
  WalletConnectSessionNamespace
>;

export interface ForgeHarnessWalletInfo {
  address: string;
  chainId: string;
  expectedMagic: number;
  isLedger: false;
  name: string;
  rpcUrl: string;
  scriptHash: string;
}

export function buildNeo3SessionNamespaces(
  config: ForgeWalletHarnessConfig,
  methods: readonly Neo3WalletConnectMethod[] = NEO3_WALLETCONNECT_METHODS
): WalletConnectSessionNamespaces {
  const namespace = getNamespaceFromChainId(config.chainId);

  return {
    [namespace]: {
      accounts: [toNeo3WalletConnectAccount(config.chainId, config.account.address)],
      chains: [config.chainId],
      events: [...NEO3_WALLETCONNECT_EVENTS],
      methods: [...methods],
    },
  };
}

export function buildHarnessWalletInfo(
  config: ForgeWalletHarnessConfig
): ForgeHarnessWalletInfo {
  return {
    address: config.account.address,
    chainId: config.chainId,
    expectedMagic: config.expectedMagic,
    isLedger: false,
    name: config.metadata.name,
    rpcUrl: config.rpcUrl,
    scriptHash: config.account.scriptHash,
  };
}

export function toNeo3WalletConnectAccount(
  chainId: string,
  address: string
): string {
  return `${chainId}:${address}`;
}

function getNamespaceFromChainId(chainId: string): string {
  const namespace = chainId.split(":")[0]?.trim();

  if (!namespace) {
    throw new Error(`Invalid WalletConnect chain id: ${chainId}`);
  }

  return namespace;
}
