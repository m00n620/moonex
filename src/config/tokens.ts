import { Network } from '../shared/types';

export const supportedTokensConfig: Record<
  Network,
  Array<{ symbol: string; decimals: number; address: string; isNative?: boolean }>
> = {
  ethereum: [
    { symbol: 'ETH', decimals: 18, address: '', isNative: true },
    { symbol: 'USDT', decimals: 6, address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
    { symbol: 'USDC', decimals: 6, address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  ],
  base: [
    { symbol: 'ETH', decimals: 18, address: '', isNative: true },
    { symbol: 'USDT', decimals: 18, address: '0x833589fCD6eDb6E08fA3F3840d4D4814C70dabcb' },
    { symbol: 'USDC', decimals: 18, address: '0x833589fCD6eDb6E08fA3F3840d4D4814C70dabcb' },
  ],
  tron: [
    { symbol: 'TRX', decimals: 18, address: '', isNative: true },
    { symbol: 'USDT', decimals: 18, address: '0x833589fCD6eDb6E08fA3F3840d4D4814C70dabcb' },
  ],
};
