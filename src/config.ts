import * as Neon from "@cityofzion/neon-js";
import {
  DEFAULT_FORGE_HARNESS_WIF,
  DEFAULT_NEO3_PRIVATE_CHAIN_ID,
  DEFAULT_NEO3_PRIVATE_NETWORK_MAGIC,
  DEFAULT_NEO3_PRIVATE_RPC_URL,
  DEFAULT_WALLETCONNECT_RELAY_URL,
} from "./constants.js";

export type HarnessEnv = Record<string, string | undefined>;

export interface ForgeWalletHarnessAccount {
  address: string;
  scriptHash: string;
  wif: string;
}

export interface ForgeWalletHarnessMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface ForgeWalletHarnessConfig {
  account: ForgeWalletHarnessAccount;
  chainId: string;
  expectedMagic: number;
  metadata: ForgeWalletHarnessMetadata;
  projectId: string;
  relayUrl: string;
  rpcUrl: string;
}

export interface LoadForgeWalletHarnessConfigOptions {
  requireProjectId?: boolean;
}

export function deriveHarnessAccount(wif: string): ForgeWalletHarnessAccount {
  try {
    const account = new Neon.wallet.Account(wif);

    return {
      address: account.address,
      scriptHash: Neon.wallet.getScriptHashFromAddress(account.address),
      wif,
    };
  } catch (error) {
    throw new Error(
      `Invalid FORGE wallet harness WIF: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function loadForgeWalletHarnessConfig(
  env: HarnessEnv = process.env,
  options: LoadForgeWalletHarnessConfigOptions = {}
): ForgeWalletHarnessConfig {
  const projectId =
    readOptionalString(
      env.FORGE_WALLET_HARNESS_REOWN_PROJECT_ID ??
        env.NEXT_PUBLIC_REOWN_PROJECT_ID
    ) ?? "";

  if (options.requireProjectId && !projectId) {
    throw new Error(
      "FORGE wallet harness requires FORGE_WALLET_HARNESS_REOWN_PROJECT_ID or NEXT_PUBLIC_REOWN_PROJECT_ID."
    );
  }

  return {
    account: deriveHarnessAccount(
      readOptionalString(
        env.FORGE_WALLET_HARNESS_WIF ?? env.E2E_TEST_ACCOUNT_WIF
      ) ?? DEFAULT_FORGE_HARNESS_WIF
    ),
    chainId:
      readOptionalString(env.FORGE_WALLET_HARNESS_CHAIN_ID) ??
      DEFAULT_NEO3_PRIVATE_CHAIN_ID,
    expectedMagic: readPositiveInteger(
      env.FORGE_WALLET_HARNESS_EXPECTED_MAGIC ??
        env.NEXT_PUBLIC_NEO_PRIVATE_NETWORK_MAGIC,
      DEFAULT_NEO3_PRIVATE_NETWORK_MAGIC,
      "FORGE_WALLET_HARNESS_EXPECTED_MAGIC"
    ),
    metadata: {
      name:
        readOptionalString(env.FORGE_WALLET_HARNESS_NAME) ??
        "FORGE Test Wallet Harness",
      description:
        readOptionalString(env.FORGE_WALLET_HARNESS_DESCRIPTION) ??
        "Local WalletConnect-compatible test wallet for FORGE proof of work.",
      url:
        readOptionalString(env.FORGE_WALLET_HARNESS_URL) ??
        "http://localhost:3000",
      icons: readIconList(env.FORGE_WALLET_HARNESS_ICONS),
    },
    projectId,
    relayUrl:
      readOptionalString(env.FORGE_WALLET_HARNESS_RELAY_URL) ??
      DEFAULT_WALLETCONNECT_RELAY_URL,
    rpcUrl:
      readDirectRpcUrl(
        env.FORGE_WALLET_HARNESS_RPC_URL ??
          env.E2E_NEO_RPC_URL ??
          env.NEXT_PUBLIC_NEO_RPC_URL
      ) ?? DEFAULT_NEO3_PRIVATE_RPC_URL,
  };
}

function readDirectRpcUrl(value: string | undefined): string | undefined {
  const trimmed = readOptionalString(value);

  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function readIconList(value: string | undefined): string[] {
  const trimmed = readOptionalString(value);

  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(",")
    .map((icon) => icon.trim())
    .filter(Boolean);
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  envName: string
): number {
  const trimmed = readOptionalString(value);

  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}
