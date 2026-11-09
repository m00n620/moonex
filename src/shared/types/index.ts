export type Network = 'evm' | 'tron';

export type EvmChain = 'ethereum' | 'base' | 'bsc';

export type Chain = EvmChain | 'tron';

export function isEvmChain(chain: Chain): chain is EvmChain {
  return chain === 'ethereum' || chain === 'base' || chain == 'bsc';
}
