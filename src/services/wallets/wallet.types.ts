import { Network } from '../../shared/types';

export interface GeneratedWallet {
  network: Network;
  address: string;
  privateKey: string;
}

export interface CreateWalletInput {
  name: string;
  network: Network;
  password: string;
}
