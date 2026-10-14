import { Chain } from '../types';

export function getTransactionUrl(chain: Chain, hash: string) {
  if (chain === 'tron') return `https://tronscan.org/transaction/${hash}`;
  if (chain === 'ethereum') return `https://etherscan.io/tx/${hash}`;
  if (chain === 'base') return `https://basescan.org/tx/${hash}`;

  return '';
}
