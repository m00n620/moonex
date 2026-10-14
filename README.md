# Moonex

Moonex is an interactive command-line wallet application for managing EVM and TRON wallets and sending supported assets across Ethereum, Base, and TRON.

## Summary

- Wallets have a network type of `evm` or `tron`; Ethereum and Base are chains, not separate wallet types.
- Create and list wallets, load a wallet on a selected chain, and send supported tokens from an interactive menu.
- EVM wallets use the same private key and address format on Ethereum and Base. Select which EVM chain to load or send on when using the wallet.
- Balances, token contracts, RPC endpoints, gas, and transactions are chain-specific. ETH on Ethereum and ETH on Base are distinct balances.
- TRON wallets use a separate key/address format and are used on the TRON chain.
- Private keys are encrypted before being stored in MongoDB and are decrypted with the wallet password when sending.

Supported assets are configured in [`src/config/tokens.ts`](./src/config/tokens.ts):

| Chain | Assets |
| --- | --- |
| Ethereum | ETH, USDT, USDC |
| Base | ETH, USDC |
| TRON | TRX, USDT |

## Requirements

- Node.js (version 22 or later recommended)
- Yarn 4 (the version declared in `package.json`)
- A MongoDB instance
- RPC endpoints for the networks you intend to use

## Configuration

The app loads `.env.development` when `NODE_ENV=development`; otherwise, it loads `.env.production`. Copy the example file to the environment file you plan to use and fill in the values:

```bash
cp .env.example .env.development
```

```dotenv
MONGODB_URI="mongodb://localhost:27017/moonex"
ETHEREUM_RPC_URL="https://your-ethereum-rpc"
BASE_RPC_URL="https://your-base-rpc"
TRON_RPC_URL="https://your-tron-rpc"
```

Only configure RPC URLs for networks you plan to use. Keep real credentials in local environment files; do not commit them.

## Install and run

Install dependencies:

```bash
corepack enable
yarn install
```

Run in development mode:

```bash
export NODE_ENV=development
yarn tsx src/index.ts
```

The application connects to MongoDB at startup, then presents a menu to create a wallet, list wallets, load a wallet, send a transaction, or exit.

For a production build and run, first create and configure `.env.production`:

```bash
cp .env.example .env.production
yarn build
export NODE_ENV=production
node dist/index.js
```

## Sending transactions

1. Choose **Send transaction** and select a wallet.
2. For an EVM wallet, choose Ethereum or Base as the chain. TRON wallets use the TRON chain.
3. Select a supported asset, enter the recipient and amount, then confirm the network and transfer details.
4. Enter the wallet password to decrypt the private key and submit the transaction.

Transfers are irreversible. Verify the recipient address and selected chain before confirming. Make sure the wallet holds the asset and enough of that chain's native coin for gas/fees. For example, a Base transfer needs Base ETH for fees, even if the same EVM wallet also has ETH on Ethereum.

## Development checks

```bash
yarn typecheck
yarn test
```

The current `test` script runs the TypeScript typecheck.
