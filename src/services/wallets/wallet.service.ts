import { input, password, select } from '@inquirer/prompts';

import { WalletRepository } from './wallet.repository';
import { getWalletPortfolio, sendToken } from '../../shared/utils/wallet';
import { decryptPrivateKey } from '../../shared/utils/encryption';

export class WalletService {
  constructor(private readonly repository = new WalletRepository()) {}

  async createWallet() {
    console.log('Creating a new wallet...');

    const walletName = await input({
      message: 'Enter a name for the new wallet:',
    });

    const walletPassword = await password({
      message: 'Enter a password for the new wallet:',
      mask: '*',
    });

    const network = await select({
      message: 'Select a network:',
      choices: [
        { name: 'Ethereum', value: 'ethereum' },
        { name: 'Tron', value: 'tron' },
      ],
    });

    await this.repository.create({
      name: walletName,
      password: walletPassword,
      network,
    });
  }

  async listWallets() {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found.');
      return;
    }

    console.log('Wallets:');
    wallets.forEach((wallet: any) => {
      console.log(`- ID: ${wallet.id}, Name: ${wallet.name}, Network: ${wallet.network}, Address: ${wallet.address}`);
    });
  }

  async selectWallet() {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found. Please create a wallet first.');
      return;
    }

    const walletId = await select({
      message: 'Select a wallet to fund:',
      choices: wallets.map((wallet) => ({
        name: `${wallet.name}`,
        value: wallet.id,
      })),
    });

    const selectedWallet = wallets.find((wallet) => wallet.id === walletId);

    return selectedWallet;
  }

  async loadWallet() {
    const selectedWallet = await this.selectWallet();

    if (!selectedWallet) {
      console.log('Selected wallet not found.');
      return;
    }

    console.log(
      `To fund the wallet, please send funds to the following address: ${selectedWallet.address} on ${selectedWallet.network}`,
    );

    const portfolio = await getWalletPortfolio(selectedWallet);
  }

  async sendTransaction() {
    const selectedWallet = await this.selectWallet();

    if (!selectedWallet) {
      console.log('Selected wallet not found.');
      return;
    }

    const token = await select({
      message: 'Select a token to send:',
      choices: [
        { name: 'USDT', value: 'usdt' },
        { name: 'USDC', value: 'usdc' },
      ],
    });

    const recipientAddress = await input({
      message: 'Enter the recipient address:',
    });

    const amount = await input({
      message: `Enter the amount of ${token.toUpperCase()} to send:`,
    });

    const walletPassword = await password({
      message: 'Enter your wallet password:',
      mask: '*',
    });

    console.log(selectedWallet);
    const privateKey = decryptPrivateKey(selectedWallet.encryptedPrivateKey, walletPassword);

    sendToken({
      privateKey,
      to: recipientAddress,
      amount,
      token,
      network: selectedWallet.network,
    });
  }
}
