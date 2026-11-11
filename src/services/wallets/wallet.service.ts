import { confirm, input, password, select } from '@inquirer/prompts';
import { NETWORKS, type Network } from '../../config/chain.types';
import { getChain, listAssets, listChains, type ChainId } from '../../config/chains';
import { getAdapter, getChainContext } from '../../networks';
import { formatAmount, parseAmount } from '../../shared/utils/amount';
import { decryptPrivateKey } from '../../shared/utils/encryption';
import {
  DEFAULT_SLIPPAGE,
  describeGas,
  describeQuote,
  estimateBridgeGas,
  executeBridge,
  explorerLink,
  getBridgeStatus,
  quoteBridge,
  trackBridge,
} from '../bridge/bridge.service';
import type { LifiStatus } from '../bridge/lifi.client';
import { sendTransfer } from '../transactions/transaction.service';
import { WalletRepository } from './wallet.repository';

const MANUAL_RECIPIENT = '__manual__';

function formatBridgeStatus(status: LifiStatus): string {
  const labels: Record<LifiStatus['status'], string> = {
    NOT_FOUND: 'waiting for the transfer to be indexed',
    INVALID: 'invalid transaction (not a bridge transfer)',
    PENDING: 'in progress',
    DONE: 'done',
    FAILED: 'failed',
  };
  const detail = status.substatusMessage ?? status.substatus;
  return `${labels[status.status] ?? status.status}${detail ? ` (${detail})` : ''}`;
}

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

  async bridgeTransfer() {
    const wallet = await this.selectWallet('Bridge from wallet:');
    if (!wallet) return;

    const fromChainId = await this.selectChain(wallet.network, 'Source chain:');
    const fromChain = getChain(fromChainId);

    const fromAsset = await select({
      message: `Asset to bridge from ${fromChain.name}:`,
      choices: listAssets(fromChainId).map((asset) => ({ name: asset.symbol, value: asset })),
    });

    const toChainId = await select<ChainId>({
      message: 'Destination chain:',
      choices: listChains()
        .filter((id) => id !== fromChainId)
        .map((id) => ({ name: `${getChain(id).name} (${getAdapter(getChain(id).network).label})`, value: id })),
    });
    const toChain = getChain(toChainId);

    const toAssets = listAssets(toChainId);
    const toAsset = await select({
      message: `Asset to receive on ${toChain.name}:`,
      choices: toAssets.map((asset) => ({ name: asset.symbol, value: asset })),
      default: toAssets.find((asset) => asset.symbol.toUpperCase() === fromAsset.symbol.toUpperCase()) ?? toAssets[0]!,
    });

    const toAddress = await this.selectRecipient(toChainId, wallet.id);

    // Masked on purpose: the amount is never echoed to the terminal.
    const amountInput = (
      await password({
        message: `Amount of ${fromAsset.symbol}:`,
        mask: '*',
        validate: (value) => {
          try {
            return parseAmount(value, fromAsset.decimals) > 0n || 'Amount must be greater than zero.';
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      })
    ).trim();
    const amount = parseAmount(amountInput, fromAsset.decimals);

    // Unlock before quoting: quotes expire in about a minute, so the confirmation should follow them directly.
    const walletPassword = await password({ message: 'Wallet password:', mask: '*' });
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(wallet.encryptedPrivateKey, walletPassword);
    } catch {
      console.log('Incorrect password.');
      return;
    }

    console.log('Finding the best bridge route...');
    const quote = await quoteBridge({
      fromChainId,
      fromAsset,
      toChainId,
      toAsset,
      amount,
      fromAddress: wallet.address,
      toAddress,
      slippage: DEFAULT_SLIPPAGE,
    });

    console.log(`\n  ${fromAsset.symbol} on ${fromChain.name}  →  ${toAsset.symbol} on ${toChain.name}`);
    console.log(`  Recipient:      ${toAddress}`);
    for (const line of describeQuote(quote)) console.log(`  ${line}`);
    console.log();

    const gas = await estimateBridgeGas(quote);
    for (const line of describeGas(quote, gas)) console.log(`  ${line}`);
    console.log();

    if (!gas.source.enoughAsset) {
      console.log(`Not enough ${fromAsset.symbol} on ${fromChain.name} for this amount. Nothing was sent.`);
      return;
    }
    if (!gas.source.enoughGas) {
      console.log(`Top up ${fromChain.nativeCurrency.symbol} on ${fromChain.name} to cover gas, then try again. Nothing was sent.`);
      return;
    }

    const confirmed = await confirm({
      message: `Bridge to ${toAddress} on ${toChain.name}? This cannot be undone.`,
      default: false,
    });
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }

    const result = await executeBridge(quote, privateKey);
    console.log(`Source transaction: ${fromChain.txUrl(result.transactionHash)}`);
    console.log(`Track the transfer:  ${explorerLink(result.transactionHash)}`);
    console.log('Waiting for delivery on the destination chain (Ctrl+C to stop; use "Bridge status" to check later)...');

    const final = await trackBridge(
      { txHash: result.transactionHash, fromChainId, toChainId, tool: result.tool },
      (status) => console.log(`  Status: ${formatBridgeStatus(status)}`),
    );
    this.printBridgeOutcome(final, toChainId);
  }

  async checkBridgeStatus() {
    const txHash = (
      await input({
        message: 'Source transaction hash:',
        validate: (value) => /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim()) || 'Enter a 32-byte transaction hash.',
      })
    ).trim();

    const status = await getBridgeStatus({ txHash });
    console.log(`Status: ${formatBridgeStatus(status)}`);
    console.log(`Details: ${status.lifiExplorerLink ?? explorerLink(txHash)}`);
    if (status.status === 'DONE' || status.status === 'FAILED') this.printBridgeOutcome(status);
  }

  private printBridgeOutcome(status: LifiStatus, toChainId?: ChainId) {
    if (status.status === 'DONE' && status.substatus !== 'REFUNDED') {
      const link =
        status.receiving?.txLink ??
        (status.receiving?.txHash && toChainId ? getChain(toChainId).txUrl(status.receiving.txHash) : status.receiving?.txHash);
      console.log(`Bridge complete.${link ? ` Destination transaction: ${link}` : ''}`);
      if (status.substatus === 'PARTIAL') {
        console.log('Note: the recipient received a different token than requested (partial route). Check the destination wallet.');
      }
    } else if (status.status === 'DONE') {
      console.log('The bridge failed and funds were refunded to the sender.');
    } else if (status.status === 'FAILED' || status.status === 'INVALID') {
      console.log('The bridge failed. Check the explorer link above; funds are usually refunded to the sender.');
    } else {
      console.log('Still in progress. Check again later with "Bridge status".');
    }
  }

  /** Recipient on the destination chain: one of the user's wallets for that network, or a pasted address. */
  private async selectRecipient(chainId: ChainId, sourceWalletId: string): Promise<string> {
    const chain = getChain(chainId);
    const adapter = getAdapter(chain.network);
    const wallets = (await this.repository.findAll()).filter((wallet) => wallet.network === chain.network);

    const choice = await select<string>({
      message: `Recipient on ${chain.name}:`,
      choices: [
        ...wallets
          .sort((a, b) => Number(b.id === sourceWalletId) - Number(a.id === sourceWalletId))
          .map((wallet) => ({
            name: `${wallet.name} ${wallet.address}${wallet.id === sourceWalletId ? ' (same wallet)' : ''}`,
            value: wallet.address,
          })),
        { name: 'Enter an address manually', value: MANUAL_RECIPIENT },
      ],
    });

    if (choice !== MANUAL_RECIPIENT) return choice;

    return (
      await input({
        message: `Recipient ${adapter.label} address on ${chain.name}:`,
        validate: (value) => adapter.isValidAddress(value.trim()) || `Not a valid ${adapter.label} address.`,
      })
    ).trim();
  }

  private async selectWallet(message = 'Select a wallet:') {
    const wallets = await this.repository.findAll();

    if (wallets.length === 0) {
      console.log('No wallets found. Please create a wallet first.');
      return;
    }

    const walletId = await select({
      message,
      choices: wallets.map((wallet) => ({ name: `${wallet.name} (${wallet.network}) ${wallet.address}`, value: wallet.id })),
    });

    return wallets.find((wallet) => wallet.id === walletId);
  }

  /** Chains available to a wallet's network; skips the prompt when there's only one. */
  private async selectChain(network: Network, message = 'Select a chain:'): Promise<ChainId> {
    const options = listChains(network);

    if (options.length === 0) {
      throw new Error(`No chains configured for network "${network}"`);
    }

    if (options.length === 1) {
      return options[0]!;
    }

    return select<ChainId>({
      message,
      choices: options.map((id) => ({ name: getChain(id).name, value: id })),
    });
  }
}
