import type { Chain as ViemChain } from 'viem';

/**
 * A network family: chains in the same family share key and address formats,
 * so one wallet can be used on every chain of its family.
 *
 * To add a new family (e.g. Solana), add it here and register a matching
 * adapter in `src/networks/index.ts` — the compiler will tell you what's missing.
 */
export const NETWORKS = ['evm', 'tron'] as const;
export type Network = (typeof NETWORKS)[number];

export interface TokenConfig {
  symbol: string;
  /** Contract address in the chain's native format. */
  address: string;
  /** Must match the contract's `decimals()`; transfers abort on mismatch. */
  decimals: number;
}

export interface NativeCurrency {
  symbol: string;
  decimals: number;
}

interface BaseChainConfig {
  /** Human-readable chain name. */
  name: string;
  nativeCurrency: NativeCurrency;
  /** Public RPC used when `<CHAIN_ID>_RPC_URL` is not set. */
  defaultRpcUrl: string;
  /** Builds a block-explorer link for a transaction hash. */
  txUrl: (hash: string) => string;
  /** Non-native tokens supported on this chain. The native coin is always included. */
  tokens: readonly TokenConfig[];
}

export interface EvmChainConfig extends BaseChainConfig {
  network: 'evm';
  viemChain: ViemChain;
}

export interface TronChainConfig extends BaseChainConfig {
  network: 'tron';
  /** Max TRX (in sun) a TRC-20 call may burn for energy. */
  feeLimitSun: number;
}

export type ChainConfig = EvmChainConfig | TronChainConfig;

export type ChainConfigFor<N extends Network> = Extract<ChainConfig, { network: N }>;

/** A sendable asset on a chain: the native coin or a token contract. */
export type Asset =
  | { kind: 'native'; symbol: string; decimals: number }
  | { kind: 'token'; symbol: string; decimals: number; address: string };
