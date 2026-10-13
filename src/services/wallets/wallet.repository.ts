import { randomUUID } from 'node:crypto';
import { generateEthereumWallet, generateTronWallet } from '../../shared/utils/wallet';
import { encryptPrivateKey } from '../../shared/utils/encryption';
import { WalletModel } from './wallet.model';
import { CreateWalletInput, GeneratedWallet } from './wallet.types';

export class WalletRepository {
  async create(input: CreateWalletInput): Promise<string> {
    const id = randomUUID();
    const { name, network, password } = input;

    let generatedWallet: GeneratedWallet | null = null;
    if (network == 'ethereum') {
      generatedWallet = generateEthereumWallet();
    } else if (network == 'tron') {
      generatedWallet = await generateTronWallet();
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

    console.log(`Wallet created with ID: ${id}, address: ${generatedWallet.address}, network: ${network}`);

    return id;
  }
  findAll() {
    return WalletModel.find().lean();
  }
}
