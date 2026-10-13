import { mainnet, base } from 'viem/chains';
import { env } from './env';
import { WalletNetwork } from '../services/wallets/wallet.types';

export const networkConfig: Record<WalletNetwork, { chain?: any; rpcUrl: string }> = {
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
  }
};
