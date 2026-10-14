import { input, password, select, confirm } from '@inquirer/prompts';

import { WalletRepository } from './wallet.repository';
import { getWalletPortfolio } from '../../shared/utils/wallet';
import { decryptPrivateKey } from '../../shared/utils/encryption';
import { supportedTokensConfig } from '../../config/tokens';
import { sendTransfer } from '../transactions/transaction.service';
import { getTransactionUrl } from '../../shared/utils/urls';
import type { Chain, Network } from '../../shared/types';
import { supportedNetworks } from '../../config/network';

export class WalletService {
  constructor(private readonly repository = new WalletRepository()) {}

  async createWallet() {
    const walletName = await input({
      message: 'Enter a name for the new wallet:',
    });

    const walletPassword = await password({
      message: 'Enter a password for the new wallet:',
      mask: '*',
    });

    const network = await select({
      message: 'Select a network:',
      choices: supportedNetworks,
    });

    await this.repository.create({
      name: walletName,
      password: walletPassword,
      network: network as Network,
    });

    console.log('Wallet created successfully.');
  }

  async listWallets() {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found.');
      return;
    }

    console.log('Wallets:');
    wallets.forEach((wallet) => {
      console.log(`- ID: ${wallet.id}, Name: ${wallet.name}, Network: ${wallet.network}, Address: ${wallet.address}`);
    });
  }

  async loadWallet() {
    const selectedWallet = await this.selectWallet();

    if (!selectedWallet) {
      console.log('Selected wallet not found.');
      return;
    }

    const chain = await this.selectChain(selectedWallet.network);
    console.log(`To fund the wallet, send funds to ${selectedWallet.address} on ${chain}.`);

    await getWalletPortfolio(selectedWallet, chain);
  }

  async sendTransaction() {
    const selectedWallet = await this.selectWallet();

    if (!selectedWallet) {
      console.log('Selected wallet not found.');
      return;
    }

    const { encryptedPrivateKey } = selectedWallet;

    const chain = await this.selectChain(selectedWallet.network);

    const token = await select({
      message: 'Select a token to send:',
      choices: supportedTokensConfig[chain].map((token) => ({ name: token.symbol, value: token.symbol })),
    });

    const recipientAddress = await input({
      message: 'Enter the recipient address:',
    });

    const amount = await password({
      message: `Enter the amount of ${token.toUpperCase()} to send:`,
      mask: '*',
    });

    const walletPassword = await password({
      message: 'Enter your wallet password:',
      mask: '*',
    });

    const confirmed = await confirm({
      message: `Please confirm this transaction to ${recipientAddress}.`,
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
      chain,
    });

    console.log(`Transaction Link: ${getTransactionUrl(result.chain, result.transactionHash)}`);
  }

  private async selectWallet() {
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

  private async selectChain(network?: Network): Promise<Chain> {
    if (network === 'tron') {
      return 'tron';
    }

    return select({
      message: 'Select a chain:',
      choices: [
        { name: 'Ethereum', value: 'ethereum' },
        { name: 'Base', value: 'base' },
      ],
    });
  }
}
