import type { Network } from '../../shared/types';

export interface GeneratedWallet {
  address: string;
  privateKey: string;
}

export interface CreateWalletInput {
  name: string;
  network: Network;
  password: string;
}
