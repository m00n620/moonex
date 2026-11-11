import type { Asset, ChainConfig } from '../config/chain.types';
import type { ChainId } from '../config/chains';

export interface GeneratedWallet {
  address: string;
  privateKey: string;
}

export interface ChainContext<C extends ChainConfig = ChainConfig> {
  id: ChainId;
  config: C;
  rpcUrl: string;
}

export interface AssetBalance {
  asset: Asset;
  /** Balance in base units, or an error message if the lookup failed. */
  balance: bigint | { error: string };
}

export interface TransferRequest<C extends ChainConfig = ChainConfig> {
  chain: ChainContext<C>;
  privateKey: string;
  to: string;
  asset: Asset;
  /** Amount in the asset's base units; always > 0. */
  amount: bigint;
}

export interface TransferResult {
  chainId: ChainId;
  transactionHash: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
}

/** Everything the app needs from a network family. One implementation per entry in `NETWORKS`. */
export interface NetworkAdapter<C extends ChainConfig = ChainConfig> {
  /** Label shown when choosing a network for a new wallet. */
  label: string;
  generateWallet(): Promise<GeneratedWallet>;
  isValidAddress(address: string): boolean;
  getBalances(chain: ChainContext<C>, address: string): Promise<AssetBalance[]>;
  transfer(request: TransferRequest<C>): Promise<TransferResult>;
}
