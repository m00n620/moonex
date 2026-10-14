import { Chain } from '../shared/types';

export const supportedTokensConfig: Record<
  Chain,
  Array<{ symbol: string; decimals: number; address: string; isNative?: boolean }>
> = {
  ethereum: [
    { symbol: 'ETH', decimals: 18, address: '', isNative: true },
    { symbol: 'USDT', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    { symbol: 'USDC', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  ],
  base: [
    { symbol: 'ETH', decimals: 18, address: '', isNative: true },
    { symbol: 'USDC', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  ],
  tron: [
    { symbol: 'TRX', decimals: 6, address: '', isNative: true },
    { symbol: 'USDT', decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  ],
};
