import type { Chain, EvmChain } from '../../shared/types';

export type AssetType = 'native' | 'token';

export interface TransferRequest {
  chain: Chain;
  privateKey: string;
  to: string;
  amount: string;
  assetType: AssetType;
  tokenAddress?: string;
}

export interface EvmTransferRequest extends Omit<TransferRequest, 'chain'> {
  chain: EvmChain;
}

export interface TransferResult {
  chain: Chain;
  transactionHash: string;
}
