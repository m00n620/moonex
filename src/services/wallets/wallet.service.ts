import { NETWORKS, type Asset, type Network } from '../../config/chain.types';
import { getChain, listAssets, listChains, type ChainId } from '../../config/chains';
import { getAdapter, getChainContext } from '../../networks';
import { confirm, input, isGoBack, password, runSteps, select } from '../../shared/prompts';
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

type Wallet = Awaited<ReturnType<WalletRepository['findAll']>>[number];

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

/**
 * Each multi-question flow runs through `runSteps`: Esc (or "← Back" in a list) re-asks the previous
 * question, and going back from the first question returns to the main menu.
 */
export class WalletService {
  constructor(private readonly repository = new WalletRepository()) {}

  async createWallet() {
    let name: string | undefined;
    let walletPassword!: string;
    let network!: Network;

    const completed = await runSteps([
      async () => {
        name = await input({
          message: 'Wallet name:',
          default: name,
          validate: (value) => value.trim().length > 0 || 'Name cannot be empty.',
        });
      },
      async () => {
        walletPassword = await password({
          message: 'Wallet password:',
          mask: '*',
          validate: (value) => value.trim().length > 0 || 'Password cannot be empty.',
        });
      },
      () =>
        password({
          message: 'Confirm password:',
          mask: '*',
          validate: (value) => value === walletPassword || 'Passwords do not match.',
        }),
      async () => {
        network = await select<Network>({
          message: 'Select a network:',
          choices: NETWORKS.map((network) => ({
            value: network,
            name: `${getAdapter(network).label} (${listChains(network)
              .map((id) => getChain(id).name)
              .join(', ')})`,
          })),
        });
      },
    ]);
    if (!completed) return;

    await this.repository.create({ name: name!.trim(), password: walletPassword, network });

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
    let wallet!: Wallet;
    let chainId!: ChainId;

    const completed = await runSteps([
      async () => {
        const selected = await this.selectWallet();
        if (!selected) return false;
        wallet = selected;
      },
      async () => {
        chainId = await this.selectChain(wallet.network);
      },
    ]);
    if (!completed) return;

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
    let wallet!: Wallet;
    let chainId!: ChainId;
    let asset!: Asset;
    let to: string | undefined;
    let amount!: string;
    let privateKey!: string;

    const completed = await runSteps([
      async () => {
        const selected = await this.selectWallet();
        if (!selected) return false;
        wallet = selected;
      },
      async () => {
        chainId = await this.selectChain(wallet.network);
      },
      async () => {
        asset = await select({
          message: 'Select an asset to send:',
          choices: listAssets(chainId).map((asset) => ({ name: asset.symbol, value: asset })),
        });
      },
      async () => {
        const adapter = getAdapter(wallet.network);
        to = (
          await input({
            message: 'Recipient address:',
            default: to,
            validate: (value) => adapter.isValidAddress(value.trim()) || `Not a valid ${adapter.label} address.`,
          })
        ).trim();
      },
      async () => {
        amount = await this.promptAmount(asset);
      },
      async () => {
        const confirmed = await confirm({
          message: `Send ${asset.symbol} on ${getChain(chainId).name} to ${to}? This cannot be undone.`,
          default: false,
        });
        if (!confirmed) {
          console.log('Cancelled.');
          return false;
        }
      },
      async () => {
        const unlocked = await this.unlock(wallet);
        if (!unlocked) return false;
        privateKey = unlocked;
      },
    ]);
    if (!completed) return;

    const result = await sendTransfer({ chainId, assetSymbol: asset.symbol, to: to!, amount, privateKey });

    console.log(`Transaction sent: ${getChain(chainId).txUrl(result.transactionHash)}`);
  }

  async bridgeTransfer() {
    let wallet!: Wallet;
    let fromChainId!: ChainId;
    let fromAsset!: Asset;
    let toChainId!: ChainId;
    let toAsset!: Asset;
    let toAddress!: string;
    let amount!: bigint;
    let privateKey!: string;
    let quote!: Awaited<ReturnType<typeof quoteBridge>>;

    const completed = await runSteps([
      async () => {
        const selected = await this.selectWallet('Bridge from wallet:');
        if (!selected) return false;
        wallet = selected;
      },
      async () => {
        fromChainId = await this.selectChain(wallet.network, 'Source chain:');
      },
      async () => {
        fromAsset = await select({
          message: `Asset to bridge from ${getChain(fromChainId).name}:`,
          choices: listAssets(fromChainId).map((asset) => ({ name: asset.symbol, value: asset })),
        });
      },
      async () => {
        toChainId = await select<ChainId>({
          message: 'Destination chain:',
          choices: listChains()
            .filter((id) => id !== fromChainId)
            .map((id) => ({ name: `${getChain(id).name} (${getAdapter(getChain(id).network).label})`, value: id })),
        });
      },
      async () => {
        const toAssets = listAssets(toChainId);
        toAsset = await select({
          message: `Asset to receive on ${getChain(toChainId).name}:`,
          choices: toAssets.map((asset) => ({ name: asset.symbol, value: asset })),
          default:
            toAssets.find((asset) => asset.symbol.toUpperCase() === fromAsset.symbol.toUpperCase()) ?? toAssets[0]!,
        });
      },
      async () => {
        toAddress = await this.selectRecipient(toChainId, wallet.id);
      },
      async () => {
        amount = parseAmount(await this.promptAmount(fromAsset), fromAsset.decimals);
      },
      // Unlock, quote and confirm form one step: quotes expire in about a minute, so the confirmation
      // should follow them directly, and going back from either prompt returns to the amount.
      async () => {
        const unlocked = await this.unlock(wallet);
        if (!unlocked) return false;
        privateKey = unlocked;

        const fromChain = getChain(fromChainId);
        const toChain = getChain(toChainId);

        console.log('Finding the best bridge route...');
        quote = await quoteBridge({
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
          return false;
        }
        if (!gas.source.enoughGas) {
          console.log(
            `Top up ${fromChain.nativeCurrency.symbol} on ${fromChain.name} to cover gas, then try again. Nothing was sent.`,
          );
          return false;
        }

        const confirmed = await confirm({
          message: `Bridge to ${toAddress} on ${toChain.name}? This cannot be undone.`,
          default: false,
        });
        if (!confirmed) {
          console.log('Cancelled.');
          return false;
        }
      },
    ]);
    if (!completed) return;

    const result = await executeBridge(quote, privateKey);
    console.log(`Source transaction: ${getChain(fromChainId).txUrl(result.transactionHash)}`);
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

    while (true) {
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

      try {
        return (
          await input({
            message: `Recipient ${adapter.label} address on ${chain.name}:`,
            validate: (value) => adapter.isValidAddress(value.trim()) || `Not a valid ${adapter.label} address.`,
          })
        ).trim();
      } catch (error) {
        // Back from the address field returns to the recipient list.
        if (!isGoBack(error)) throw error;
      }
    }
  }

  // Masked on purpose: the amount is never echoed to the terminal.
  private async promptAmount(asset: Asset): Promise<string> {
    return (
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
  }

  /** Asks for the wallet password and returns the private key, or undefined if the password is wrong. */
  private async unlock(wallet: Wallet): Promise<string | undefined> {
    const walletPassword = await password({ message: 'Wallet password:', mask: '*' });
    try {
      return decryptPrivateKey(wallet.encryptedPrivateKey, walletPassword);
    } catch {
      console.log('Incorrect password.');
      return undefined;
    }
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
