import { randomUUID } from "node:crypto";
import { db } from "./connection";
import { generateEthereumWallet, generateTronWallet } from "../shared/utils/wallet";
import { encryptPrivateKey } from "../shared/utils/encryption";
import { CreateWalletInput, GeneratedWallet } from "../types/wallet.types";

export const walletRepository = {
  async create(input: CreateWalletInput): Promise<string> {
    const id = randomUUID();
    const { name, network, password } = input;

    let generatedWallet: GeneratedWallet | null = null;
    if (network == "ethereum") {
      generatedWallet = generateEthereumWallet();
    } else if (network == "tron") {
      generatedWallet = await generateTronWallet();
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
    
    const encrypted = encryptPrivateKey(generatedWallet.privateKey, password);

    db.prepare(`
      INSERT INTO wallets (
        id, name, network, address, encrypted_private_key, encryption_salt, encryption_iv, encryption_auth_tag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      network,
      generatedWallet.address,
      encrypted.ciphertext,
      encrypted.salt,
      encrypted.iv,
      encrypted.authTag
    );

    console.log(`Wallet created with ID: ${id}, address: ${generatedWallet.address}, network: ${network}`);

    return id;
  },
  async findAll() {
    const rows = db.prepare("SELECT id, name, network, address FROM wallets").all();
    return rows;
  }
};
