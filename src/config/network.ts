import { mainnet, base } from 'viem/chains';
import { env } from './env';
import { Network } from '../shared/types';

export const networkConfig: Record<Network, { chain?: any; rpcUrl: string }> = {
  ethereum: {
    chain: mainnet,
    rpcUrl: env.rpcUrls.ethereum,
  },
  base: {
    chain: base,
    rpcUrl: env.rpcUrls.base,
  },
  tron: {
    rpcUrl: env.rpcUrls.tron,
  },
};
