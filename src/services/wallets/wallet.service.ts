import { input, password, select, confirm } from '@inquirer/prompts';

import { WalletRepository } from './wallet.repository';
import { getWalletPortfolio } from '../../shared/utils/wallet';
import { decryptPrivateKey } from '../../shared/utils/encryption';
import { supportedTokensConfig } from '../../config/tokens';
import { sendTransfer } from '../transactions/transaction.service';
import { getTransactionUrl } from '../../shared/utils/urls';

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
      message: 'Select a wallet:',
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

    const { network, encryptedPrivateKey } = selectedWallet;

    const token = await select({
      message: 'Select a token to send:',
      choices: supportedTokensConfig[network].map((token) => ({ name: token.symbol, value: token.symbol })),
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

    const confirmed = await confirm({
      message: `Are you sure you want to send ${amount} ${token} to ${recipientAddress}?`,
    });

    if (!confirmed) {
      return;
    }

    const privateKey = decryptPrivateKey(encryptedPrivateKey, walletPassword);

    const result = await sendTransfer({
      privateKey,
      to: recipientAddress,
      amount,
      token,
      network,
    });

    if (result) {
      console.log(`Transaction Link: ${getTransactionUrl(result.network, result.transactionHash)}`);
    }
  }
}
