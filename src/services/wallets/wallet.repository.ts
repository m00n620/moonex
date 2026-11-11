import { randomUUID } from 'node:crypto';
import { getAdapter } from '../../networks';
import { encryptPrivateKey } from '../../shared/utils/encryption';
import { WalletModel } from './wallet.model';
import type { CreateWalletInput } from './wallet.types';

export class WalletRepository {
  async create({ name, network, password }: CreateWalletInput): Promise<string> {
    if (!password.trim()) {
      throw new Error('Wallet password cannot be empty.');
    }

    const id = randomUUID();
    const generated = await getAdapter(network).generateWallet();

    await WalletModel.create({
      id,
      name,
      network,
      address: generated.address,
      encryptedPrivateKey: encryptPrivateKey(generated.privateKey, password),
    });

    return id;
  }

  findAll() {
    return WalletModel.find().sort({ createdAt: 1 }).lean();
  }
}
