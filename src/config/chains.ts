import { mainnet, base, bsc } from 'viem/chains';
import type { Chain as ViemChain } from 'viem';
import { getEnv } from './env';
import type { Asset, ChainConfig, EvmChainConfig, Network, TokenConfig, TronChainConfig } from './chain.types';

/* -------------------------------------------------------------------------- */
/*  Chain registry — the single place to add chains and tokens.               */
/*                                                                            */
/*  Add an EVM chain:  myChain: evmChain(viemChainObject, { tokens: [...] }), */
/*  Add a token:       append { symbol, address, decimals } to `tokens`.      */
/*  RPC override:      set <CHAIN_ID>_RPC_URL, e.g. ARBITRUM_RPC_URL.         */
/* -------------------------------------------------------------------------- */

export const chains = {
  ethereum: evmChain(mainnet, {
    tokens: [
      { symbol: 'USDT', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
  }),
  base: evmChain(base, {
    tokens: [{ symbol: 'USDC', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
  }),
  bsc: evmChain(bsc, {
    name: 'BNB Smart Chain',
    tokens: [{ symbol: 'USDC', decimals: 18, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }],
  }),
  tron: tronChain({
    name: 'TRON',
    chainId: 728_126_428,
    defaultRpcUrl: 'https://api.trongrid.io',
    explorerUrl: 'https://tronscan.org/#/transaction',
    feeLimitSun: 100_000_000, // 100 TRX
    tokens: [{ symbol: 'USDT', decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }],
  }),
} satisfies Record<string, ChainConfig>;

export type ChainId = keyof typeof chains;

/* --------------------------------- Helpers -------------------------------- */

export function isChainId(value: string): value is ChainId {
  return Object.hasOwn(chains, value);
}

export function getChain(id: ChainId): ChainConfig {
  return chains[id];
}

export function listChains(network?: Network): ChainId[] {
  return (Object.keys(chains) as ChainId[]).filter((id) => !network || chains[id].network === network);
}

/** RPC URL for a chain: `<CHAIN_ID>_RPC_URL` from the environment, else the chain's public default. */
export function getRpcUrl(id: ChainId): string {
  return getEnv(`${id.toUpperCase()}_RPC_URL`) || chains[id].defaultRpcUrl;
}

/** All sendable assets on a chain, native coin first. */
export function listAssets(id: ChainId): Asset[] {
  const chain = getChain(id);
  return [
    { kind: 'native', ...chain.nativeCurrency },
    ...chain.tokens.map((token) => ({ kind: 'token' as const, ...token })),
  ];
}

export function findAsset(id: ChainId, symbol: string): Asset | undefined {
  return listAssets(id).find((asset) => asset.symbol.toUpperCase() === symbol.toUpperCase());
}

/* ------------------------------ Chain builders ----------------------------- */

/** Builds an EVM chain config from a viem chain; name, native coin, RPC and explorer come from viem unless overridden. */
function evmChain(
  viemChain: ViemChain,
  options: { tokens?: TokenConfig[]; name?: string; defaultRpcUrl?: string; explorerUrl?: string } = {},
): EvmChainConfig {
  const explorerUrl = options.explorerUrl ?? viemChain.blockExplorers?.default.url ?? '';
  const defaultRpcUrl = options.defaultRpcUrl ?? viemChain.rpcUrls.default.http[0] ?? '';

  return {
    network: 'evm',
    viemChain,
    name: options.name ?? viemChain.name,
    chainId: viemChain.id,
    nativeCurrency: { symbol: viemChain.nativeCurrency.symbol, decimals: viemChain.nativeCurrency.decimals },
    defaultRpcUrl,
    txUrl: (hash) => (explorerUrl ? `${explorerUrl.replace(/\/$/, '')}/tx/${hash}` : hash),
    tokens: options.tokens ?? [],
  };
}

function tronChain(options: {
  name: string;
  chainId: number;
  defaultRpcUrl: string;
  explorerUrl: string;
  feeLimitSun: number;
  tokens?: TokenConfig[];
}): TronChainConfig {
  return {
    network: 'tron',
    name: options.name,
    chainId: options.chainId,
    nativeCurrency: { symbol: 'TRX', decimals: 6 },
    defaultRpcUrl: options.defaultRpcUrl,
    txUrl: (hash) => `${options.explorerUrl}/${hash}`,
    feeLimitSun: options.feeLimitSun,
    tokens: options.tokens ?? [],
  };
}
