import type { Network } from '../../config/chain.types';

export interface CreateWalletInput {
  name: string;
  network: Network;
  password: string;
}
