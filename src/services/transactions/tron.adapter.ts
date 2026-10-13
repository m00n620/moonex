import { TronWeb } from 'tronweb';

import { networkConfig } from '../../config/network';
import TRC20_ABI from '../../shared/abis/trc20.json';

import { TransferRequest, TransferResult } from './transaction.types';

function toBaseUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error('Invalid amount');
  }

  const [whole, fraction = ''] = amount.split('.');

  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimals`);
  }

  return (
    BigInt(whole ?? '0') * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
  );
}

export async function sendTron(request: TransferRequest): Promise<TransferResult> {
  const network = networkConfig[request.network];

  if (!network.rpcUrl) {
    throw new Error(`TRON RPC is not configured`);
  }

  const tronWeb = new TronWeb({
    fullHost: network.rpcUrl,
    privateKey: request.privateKey,
  });

  if (!tronWeb.isAddress(request.to)) {
    throw new Error('Invalid TRON recipient address');
  }

  const sender = tronWeb.defaultAddress.base58;

  if (!sender) {
    throw new Error('Unable to determine sender address');
  }

  if (request.assetType === 'native') {
    const amountSun = toBaseUnits(request.amount, 6);

    if (amountSun <= 0n) {
      throw new Error('Amount must be greater than zero');
    }

    if (amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Amount exceeds supported TRX transfer range');
    }

    const balanceSun = BigInt(await tronWeb.trx.getBalance(sender));

    // Leave additional TRX for network resources and fees.
    if (balanceSun < amountSun) {
      throw new Error('Insufficient TRX balance');
    }

    const transaction = await tronWeb.transactionBuilder.sendTrx(request.to, Number(amountSun), sender);

    const signed = await tronWeb.trx.sign(transaction);
    const result = await tronWeb.trx.sendRawTransaction(signed);

    if (!result.result || !result.txid) {
      throw new Error('TRON transaction broadcast failed');
    }

    return {
      network: request.network,
      transactionHash: result.txid,
    };
  }

  if (!request.tokenAddress || !tronWeb.isAddress(request.tokenAddress)) {
    throw new Error('A valid TRC-20 contract address is required');
  }

  const token = await tronWeb.contract(TRC20_ABI, request.tokenAddress);

  const decimals = Number(await token.decimals().call());
  const amount = toBaseUnits(request.amount, decimals);

  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero');
  }

  const balance = BigInt(String(await token.balanceOf(sender).call()));

  if (balance < amount) {
    throw new Error('Insufficient token balance');
  }

  const txid = await token.transfer(request.to, amount.toString()).send({
    feeLimit: 100_000_000,
  });

  return {
    network: request.network,
    transactionHash: typeof txid === 'string' ? txid : String(txid),
  };
}
