import { randomUUID } from 'node:crypto';
import { generateEvmWallet, generateTronWallet } from '../../shared/utils/wallet';
import { encryptPrivateKey } from '../../shared/utils/encryption';
import { WalletModel } from './wallet.model';
import { CreateWalletInput, GeneratedWallet } from './wallet.types';

export class WalletRepository {
  async create(input: CreateWalletInput): Promise<string> {
    const id = randomUUID();
    const { name, network, password } = input;

    if (!password.trim()) {
      throw new Error('Wallet password cannot be empty.');
    }

    let generatedWallet: GeneratedWallet;
    if (network === 'tron') {
      generatedWallet = await generateTronWallet();
    } else if (network === 'evm') {
      generatedWallet = generateEvmWallet();
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }

    const encryptedPrivateKey = encryptPrivateKey(generatedWallet.privateKey, password);

    await WalletModel.create({
      id,
      name,
      network,
      address: generatedWallet.address,
      encryptedPrivateKey,
    });

    return id;
  }
  findAll() {
    return WalletModel.find().lean();
  }
}
