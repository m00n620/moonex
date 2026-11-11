import { TronWeb } from 'tronweb';
import type { TronChainConfig } from '../config/chain.types';
import { listAssets } from '../config/chains';
import { formatAmount } from '../shared/utils/amount';
import TRC20_ABI from '../shared/abis/trc20.json';
import type { AssetBalance, ChainContext, NetworkAdapter, TransferResult } from './network.types';

function tronWebFor(chain: ChainContext<TronChainConfig>, privateKey?: string): TronWeb {
  return new TronWeb(privateKey ? { fullHost: chain.rpcUrl, privateKey } : { fullHost: chain.rpcUrl });
}

export const tronAdapter: NetworkAdapter<TronChainConfig> = {
  label: 'TRON',

  async generateWallet() {
    const account = await TronWeb.createAccount();
    return { address: account.address.base58, privateKey: account.privateKey };
  },

  isValidAddress(address) {
    return TronWeb.isAddress(address);
  },

  async getBalances(chain, address) {
    const tronWeb = tronWebFor(chain);
    // Constant contract calls need an owner address.
    tronWeb.setAddress(address);

    const assets = listAssets(chain.id);
    const settled = await Promise.allSettled(
      assets.map(async (asset) => {
        if (asset.kind === 'native') {
          return BigInt(await tronWeb.trx.getBalance(address));
        }
        const contract = await tronWeb.contract(TRC20_ABI, asset.address);
        return BigInt(String(await contract.balanceOf(address).call()));
      }),
    );

    return settled.map(
      (result, i): AssetBalance => ({
        asset: assets[i]!,
        balance: result.status === 'fulfilled' ? result.value : { error: String(result.reason?.message ?? result.reason) },
      }),
    );
  },

  async transfer({ chain, privateKey, to, asset, amount }): Promise<TransferResult> {
    if (!TronWeb.isAddress(to)) {
      throw new Error('Invalid TRON recipient address');
    }

    const tronWeb = tronWebFor(chain, privateKey.replace(/^0x/, ''));
    const sender = tronWeb.defaultAddress.base58;

    if (!sender) {
      throw new Error('Unable to determine sender address');
    }

    if (asset.kind === 'native') {
      if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Amount exceeds supported TRX transfer range');
      }

      const balance = BigInt(await tronWeb.trx.getBalance(sender));
      if (balance < amount) {
        throw new Error(`Insufficient TRX. Balance: ${formatAmount(balance, asset.decimals)} TRX`);
      }

      const transaction = await tronWeb.transactionBuilder.sendTrx(to, Number(amount), sender);
      const signed = await tronWeb.trx.sign(transaction);
      const result = await tronWeb.trx.sendRawTransaction(signed);

      if (!result.result || !result.txid) {
        throw new Error('TRON transaction broadcast failed');
      }

      return { chainId: chain.id, transactionHash: result.txid };
    }

    const contract = await tronWeb.contract(TRC20_ABI, asset.address);
    const onChainDecimals = Number(await contract.decimals().call());

    if (onChainDecimals !== asset.decimals) {
      throw new Error(
        `${asset.symbol} on ${chain.config.name} has ${onChainDecimals} decimals on-chain but ` +
          `${asset.decimals} in config. Fix src/config/chains.ts before sending.`,
      );
    }

    const balance = BigInt(String(await contract.balanceOf(sender).call()));
    if (balance < amount) {
      throw new Error(`Insufficient ${asset.symbol}. Balance: ${formatAmount(balance, asset.decimals)} ${asset.symbol}`);
    }

    const txid = await contract.transfer(to, amount.toString()).send({ feeLimit: chain.config.feeLimitSun });

    return { chainId: chain.id, transactionHash: String(txid) };
  },
};
