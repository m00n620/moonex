# Moonex

Moonex is an interactive command-line wallet application for managing EVM and TRON wallets and sending supported assets across Ethereum, Base, BNB Smart Chain, and TRON.

## Summary

- Wallets have a network type of `evm` or `tron`. Ethereum, Base and BSC are chains, not separate wallet types.
- Create and list wallets, view a wallet's balances on a selected chain, and send supported assets from an interactive menu.
- EVM wallets use the same private key and address on every EVM chain. Choose the EVM chain when loading a wallet or sending from it.
- Balances, token contracts, RPC endpoints, gas, and transactions are chain-specific. ETH on Ethereum and ETH on Base are distinct balances.
- TRON wallets use a separate key/address format and are used on the TRON chain.
- Private keys are encrypted (AES-256-GCM, scrypt-derived key) before being stored in MongoDB, and are decrypted with the wallet password when sending.

Chains and assets are configured in [`src/config/chains.ts`](./src/config/chains.ts). Each chain's native coin is always available; tokens are listed per chain:

| Chain (id) | Native | Tokens |
| --- | --- | --- |
| Ethereum (`ethereum`) | ETH | USDT, USDC |
| Base (`base`) | ETH | USDC |
| BNB Smart Chain (`bsc`) | BNB | USDC |
| TRON (`tron`) | TRX | USDT |

## Requirements

- Node.js 22 or later
- Yarn 4 (the version declared in `package.json`)
- A MongoDB instance
- RPC endpoints for the chains you use (optional; public defaults are used otherwise)

## Configuration

The app loads `.env.development` when `NODE_ENV=development`; otherwise, it loads `.env.production`. Copy the example file to the environment file you plan to use and fill in the values:

```bash
cp .env.example .env.development
```

```dotenv
MONGODB_URI="mongodb://localhost:27017/moonex"
ETHEREUM_RPC_URL="https://your-ethereum-rpc"
BASE_RPC_URL="https://your-base-rpc"
BSC_RPC_URL="https://your-bsc-rpc"
TRON_RPC_URL="https://your-tron-rpc"
```

RPC URLs are optional and follow the pattern `<CHAIN_ID>_RPC_URL`. A chain without one falls back to its public default RPC, which is rate-limited, so set your own for real use. Keep real credentials in local environment files; do not commit them.

## Install and run

```bash
corepack enable
yarn install
yarn dev            # development (.env.development)
```

The application connects to MongoDB at startup, then presents a menu to create a wallet, list wallets, load a wallet's balances, send a transaction, or exit.

Production build and run (create `.env.production` first):

```bash
cp .env.example .env.production
yarn build
yarn start
```

## Sending transactions

1. Choose **Send transaction** and select a wallet.
2. For an EVM wallet, choose the EVM chain. A network with a single chain (TRON) is selected automatically.
3. Select an asset, then enter the recipient and amount. Both are validated as you type; the amount is masked and never shown on screen.
4. Confirm the summary (asset, chain, recipient), then enter the wallet password to decrypt the key and submit.

Transfers are irreversible. Verify the recipient address and selected chain before confirming. Make sure the wallet holds the asset and enough of that chain's native coin for gas/fees. For example, a Base transfer needs Base ETH for fees, and a BSC transfer needs BNB, even if the same EVM wallet holds ETH on Ethereum.

## Adding chains and tokens

Everything chain-specific lives in [`src/config/chains.ts`](./src/config/chains.ts).

**Add a token:** append it to the chain's `tokens` list. `decimals` must match the contract; transfers abort if the on-chain value differs.

```ts
base: evmChain(base, {
  tokens: [
    { symbol: 'USDC', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    { symbol: 'XYZ', decimals: 18, address: '0x...' },
  ],
}),
```

**Add an EVM chain:** import its definition from `viem/chains` and add one entry. The name, native coin, default RPC and block explorer come from viem; pass `name`, `defaultRpcUrl` or `explorerUrl` to override them. Existing EVM wallets work on the new chain right away.

```ts
import { arbitrum } from 'viem/chains';
// ...
arbitrum: evmChain(arbitrum, { tokens: [/* ... */] }),
```

Optionally set `ARBITRUM_RPC_URL`. No other code changes are needed: menus, balances, sending and explorer links all read from the registry.

**Add a network family** (a new key/address format, such as Solana):

1. Add it to `NETWORKS` in [`src/config/chain.types.ts`](./src/config/chain.types.ts), with a chain config type.
2. Implement `NetworkAdapter` (wallet generation, address validation, balances, transfer) in `src/networks/`.
3. Register it in [`src/networks/index.ts`](./src/networks/index.ts). The compiler reports anything still missing.

`yarn test` checks every configured chain and token: valid address format for its network, sane decimals, no duplicate symbols, and a valid RPC and explorer URL.

## Project layout

```
src/
  config/chains.ts        chain + token registry (edit this to add chains/tokens)
  config/chain.types.ts   network families and config types
  networks/               one adapter per network family (evm, tron)
  services/               wallet CLI flows, transfer orchestration, persistence
  shared/utils/           amount parsing/formatting, key encryption
test/                     unit tests (node:test via tsx)
```

## Development checks

```bash
yarn typecheck   # TypeScript only
yarn test        # typecheck + unit tests
```
