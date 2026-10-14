import { mainnet, base } from 'viem/chains';
import { env } from './env';
import { Chain } from '../shared/types';

export const networkConfig: Record<Chain, { chain?: any; rpcUrl: string }> = {
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

export const supportedNetworks = [
  { value: 'evm', name: 'EVM' },
  { value: 'tron', name: 'Tron' },
];

export const supportedEvmChains = [
  { value: 'etherum', name: 'Ethereum' },
  { value: 'base', name: 'Base' },
];
