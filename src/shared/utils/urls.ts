import { Network } from '../types';

export function getTransactionUrl(network: Network, hash: string) {
  if (network === 'tron') return `https://tronscan.org/transaction/${hash}`;
  if (network === 'ethereum') return `https://etherscan.io/tx/${hash}`;
  if (network === 'base') return `https://basescan.org/tx/${hash}`;

  return '';
}
