import { confirm, input, password, select } from '@inquirer/prompts';
import { NETWORKS, type Network } from '../../config/chain.types';
import { getChain, listAssets, listChains, type ChainId } from '../../config/chains';
import { getAdapter, getChainContext } from '../../networks';
import { formatAmount, parseAmount } from '../../shared/utils/amount';
import { decryptPrivateKey } from '../../shared/utils/encryption';
import { sendTransfer } from '../transactions/transaction.service';
import { WalletRepository } from './wallet.repository';

export class WalletService {
  constructor(private readonly repository = new WalletRepository()) {}

  async createWallet() {
    const name = await input({
      message: 'Wallet name:',
      validate: (value) => value.trim().length > 0 || 'Name cannot be empty.',
    });

    const walletPassword = await password({
      message: 'Wallet password:',
      mask: '*',
      validate: (value) => value.trim().length > 0 || 'Password cannot be empty.',
    });

    await password({
      message: 'Confirm password:',
      mask: '*',
      validate: (value) => value === walletPassword || 'Passwords do not match.',
    });

    const network = await select<Network>({
      message: 'Select a network:',
      choices: NETWORKS.map((network) => ({
        value: network,
        name: `${getAdapter(network).label} (${listChains(network)
          .map((id) => getChain(id).name)
          .join(', ')})`,
      })),
    });

    await this.repository.create({ name: name.trim(), password: walletPassword, network });

    console.log('Wallet created successfully.');
  }

  async listWallets() {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found.');
      return;
    }

    console.table(
      wallets.map((wallet) => ({ name: wallet.name, network: wallet.network, address: wallet.address, id: wallet.id })),
    );
  }

  async loadWallet() {
    const wallet = await this.selectWallet();
    if (!wallet) return;

    const chainId = await this.selectChain(wallet.network);
    const chain = getChainContext(chainId);

    console.log(`\n${wallet.name} on ${chain.config.name}`);
    console.log(`Address: ${wallet.address}  (send funds here on ${chain.config.name} only)\n`);

    const balances = await getAdapter(wallet.network).getBalances(chain, wallet.address);

    for (const { asset, balance } of balances) {
      const shown = typeof balance === 'bigint' ? formatAmount(balance, asset.decimals) : `error: ${balance.error}`;
      console.log(`  ${asset.symbol.padEnd(8)} ${shown}`);
    }
    console.log();
  }

  async sendTransaction() {
    const wallet = await this.selectWallet();
    if (!wallet) return;

    const adapter = getAdapter(wallet.network);
    const chainId = await this.selectChain(wallet.network);
    const chain = getChain(chainId);

    const asset = await select({
      message: 'Select an asset to send:',
      choices: listAssets(chainId).map((asset) => ({ name: asset.symbol, value: asset })),
    });

    const to = (
      await input({
        message: 'Recipient address:',
        validate: (value) => adapter.isValidAddress(value.trim()) || `Not a valid ${adapter.label} address.`,
      })
    ).trim();

    // Masked on purpose: the amount is never echoed to the terminal.
    const amount = (
      await password({
        message: `Amount of ${asset.symbol}:`,
        mask: '*',
        validate: (value) => {
          try {
            return parseAmount(value, asset.decimals) > 0n || 'Amount must be greater than zero.';
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      })
    ).trim();

    const confirmed = await confirm({
      message: `Send ${asset.symbol} on ${chain.name} to ${to}? This cannot be undone.`,
      default: false,
    });

    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }

    const walletPassword = await password({ message: 'Wallet password:', mask: '*' });

    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(wallet.encryptedPrivateKey, walletPassword);
    } catch {
      console.log('Incorrect password.');
      return;
    }

    const result = await sendTransfer({ chainId, assetSymbol: asset.symbol, to, amount, privateKey });

    console.log(`Transaction sent: ${chain.txUrl(result.transactionHash)}`);
  }

  private async selectWallet() {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found. Please create a wallet first.');
      return;
    }

    const walletId = await select({
      message: 'Select a wallet:',
      choices: wallets.map((wallet) => ({ name: `${wallet.name} (${wallet.network}) ${wallet.address}`, value: wallet.id })),
    });

    return wallets.find((wallet) => wallet.id === walletId);
  }

  /** Chains available to a wallet's network; skips the prompt when there's only one. */
  private async selectChain(network: Network): Promise<ChainId> {
    const options = listChains(network);

    if (options.length === 0) {
      throw new Error(`No chains configured for network "${network}"`);
    }

    if (options.length === 1) {
      return options[0]!;
    }

    return select<ChainId>({
      message: 'Select a chain:',
      choices: options.map((id) => ({ name: getChain(id).name, value: id })),
    });
  }
}
