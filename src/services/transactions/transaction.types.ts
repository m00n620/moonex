import { Network } from '../../shared/types';

export type AssetType = 'native' | 'token';

export interface TransferRequest {
  network: Network;
  privateKey: string;
  to: string;
  amount: string;
  assetType: AssetType;
  tokenAddress?: string;
}

export interface TransferResult {
  network: Network;
  transactionHash: string;
}
