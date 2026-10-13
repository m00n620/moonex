export type WalletNetwork = "ethereum" | "tron";

export interface GeneratedWallet {
  network: WalletNetwork;
  address: string;
  privateKey: string;
}

export interface Wallet {
  id: string;
  name: string;
  network: WalletNetwork;
  address: string;
  encrypted_private_key: Buffer;
  encryption_salt: Buffer;
  encryption_iv: Buffer;
  encryption_auth_tag: Buffer;
  created_at: string;
}

export interface CreateWalletInput {
  name: string;
  network: WalletNetwork;
  password: string;
}
