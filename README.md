# FORGE Wallet Harness

Shared WalletConnect-compatible local wallet harness for FORGE web and
HushForgeAndroid tests.

The harness is intentionally a separate repository because both clients need the
same CI wallet behavior:

- local WalletConnect relay
- `/pair` endpoint for Android emulator pairing
- Neo3 private-net account and magic validation
- WalletConnect approval for `getNetworkVersion`, `getWalletInfo`, and
  `invokeFunction`
- Neo transaction signing/submission through a configured RPC URL

## Defaults

- RPC: `http://localhost:10332`
- chain id: `neo3:private`
- expected network magic: `5195086`
- account: `NV1Q1dTdvzPbThPbSFz7zudTmsmgnCwX6c`
- local relay: `ws://127.0.0.1:32102`
- pair endpoint: `http://127.0.0.1:32103/pair`

## Commands

```powershell
npm ci
npm test
npm run build
npm run dev:server
```

`npm run dev:server` starts the local WalletConnect relay and the HTTP pairing
endpoint used by HushForgeAndroid CI.

## Environment

```text
FORGE_WALLET_HARNESS_RPC_URL=http://127.0.0.1:10332
FORGE_WALLET_HARNESS_RELAY_PORT=32102
FORGE_WALLET_HARNESS_PAIR_PORT=32103
FORGE_WALLET_HARNESS_REOWN_PROJECT_ID=forge-local-project
FORGE_WALLET_HARNESS_WIF=<private-net-wallet-wif>
FORGE_WALLET_HARNESS_EXPECTED_MAGIC=5195086
```

For Android emulator tests, build the app with:

```text
FORGE_REOWN_RELAY_URL=ws://10.0.2.2:32102?projectId=forge-local-project
FORGE_MOBILE_WALLET_HARNESS_PAIR_URL=http://10.0.2.2:32103/pair
```

The emulator uses `10.0.2.2` to reach services running on the GitHub Actions or
developer host.
