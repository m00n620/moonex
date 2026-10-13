export type WalletNetwork = 'ethereum' | 'tron' | 'base';

export interface GeneratedWallet {
  network: WalletNetwork;
  address: string;
  privateKey: string;
}

export interface CreateWalletInput {
  name: string;
  network: WalletNetwork;
  password: string;
}
