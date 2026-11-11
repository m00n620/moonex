import type { ChainConfig, ChainConfigFor, Network } from '../config/chain.types';
import { getChain, getRpcUrl, type ChainId } from '../config/chains';
import { evmAdapter } from './evm.adapter';
import { tronAdapter } from './tron.adapter';
import type { ChainContext, NetworkAdapter } from './network.types';

/** One adapter per network family. Adding a family to `NETWORKS` makes this a compile error until it is registered. */
const adapters: { [N in Network]: NetworkAdapter<ChainConfigFor<N>> } = {
  evm: evmAdapter,
  tron: tronAdapter,
};

export function getAdapter(network: Network): NetworkAdapter<ChainConfig> {
  // Safe: callers pass chain contexts whose config.network matches `network` (see getChainContext).
  return adapters[network] as NetworkAdapter<ChainConfig>;
}

export function getChainContext(id: ChainId): ChainContext {
  return { id, config: getChain(id), rpcUrl: getRpcUrl(id) };
}

export type * from './network.types';
