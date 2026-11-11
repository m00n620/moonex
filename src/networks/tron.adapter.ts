import { setTimeout as delay } from 'node:timers/promises';
import { TronWeb, type Types } from 'tronweb';
import type { TronChainConfig } from '../config/chain.types';
import { listAssets } from '../config/chains';
import { getEnv } from '../config/env';
import { formatAmount } from '../shared/utils/amount';
import TRC20_ABI from '../shared/abis/trc20.json';
import type { AssetBalance, ChainContext, NetworkAdapter, TransferResult } from './network.types';

const CONFIRMATION_TIMEOUT_MS = 90_000;
const CONFIRMATION_POLL_MS = 3_000;
/** Refuse to sign a prepared transaction that expires sooner than this. */
const MIN_EXPIRATION_MARGIN_MS = 15_000;

/** The unsigned transaction a router returns for TRON (TronWeb's transaction shape). */
interface UnsignedTronTransaction {
  txID: string;
  raw_data_hex: string;
  visible?: boolean;
  raw_data: {
    expiration?: number;
    contract?: Array<{
      type?: string;
      parameter?: {
        value?: { owner_address?: string; contract_address?: string; call_value?: number | string; data?: string };
      };
    }>;
  };
}

function tronWebFor(chain: ChainContext<TronChainConfig>, privateKey?: string): TronWeb {
  // TronGrid heavily rate-limits requests without an API key (HTTP 429).
  const apiKey = getEnv('TRON_API_KEY');
  const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined;
  return new TronWeb({ fullHost: chain.rpcUrl, ...(headers && { headers }), ...(privateKey && { privateKey }) });
}

/** Normalises a TRON address given as base58 (`T…`), `41…` hex or 20-byte `0x…` hex to base58. */
function toBase58(address: string): string {
  return TronWeb.address.fromHex(address);
}

function decodeMessage(hex: string | undefined): string {
  if (!hex) return '';
  return /^[0-9a-f]+$/i.test(hex) ? Buffer.from(hex, 'hex').toString('utf8') : hex;
}

/**
 * Simulates a contract call via the node's `triggerconstantcontract` and returns the TRX (in sun)
 * that would be burned for energy after the account's available (staked) energy is used.
 * Throws if the simulation reverts.
 */
async function estimateEnergyBurn(
  tronWeb: TronWeb,
  sender: string,
  call: { owner_address?: string; contract_address?: string; call_value?: number | string; data?: string },
): Promise<bigint> {
  const [needed, resources] = await Promise.all([simulateEnergy(tronWeb, sender, call), accountResources(tronWeb, sender)]);
  return needed > resources.energy ? (needed - resources.energy) * resources.energyPrice : 0n;
}

/** Approximate serialized size of a signed TRC-20 `approve` transaction, in bytes (bandwidth). */
const APPROVE_TX_BYTES = 345n;
/** Signature and envelope bytes added to raw_data when a transaction is signed and broadcast. */
const SIGNED_TX_OVERHEAD_BYTES = 134n;

/** Energy/bandwidth the account can use without burning TRX, and the TRX (sun) prices when it must burn. */
async function accountResources(tronWeb: TronWeb, owner: string) {
  const [resources, parameters] = await Promise.all([
    tronWeb.trx.getAccountResources(owner),
    tronWeb.trx.getChainParameters(),
  ]);
  const param = (key: string, fallback: number) => BigInt(parameters.find((p) => p.key === key)?.value ?? fallback);
  const left = (limit?: number, used?: number) => BigInt(Math.max(0, (limit ?? 0) - (used ?? 0)));

  return {
    energy: left(resources.EnergyLimit, resources.EnergyUsed),
    bandwidth: left(resources.freeNetLimit, resources.freeNetUsed) + left(resources.NetLimit, resources.NetUsed),
    energyPrice: param('getEnergyFee', 100),
    bandwidthPrice: param('getTransactionFee', 1000),
  };
}

/** Energy a contract call would use. Throws if the simulation reverts. */
async function simulateEnergy(
  tronWeb: TronWeb,
  sender: string,
  call: { contract_address?: string; call_value?: number | string; data?: string },
): Promise<bigint> {
  const simulation = await tronWeb.fullNode.request<{
    result?: { result?: boolean; message?: string };
    energy_used?: number;
  }>(
    'wallet/triggerconstantcontract',
    {
      owner_address: TronWeb.address.toHex(sender),
      contract_address: TronWeb.address.toHex(toBase58(call.contract_address ?? '')),
      data: call.data ?? '',
      call_value: Number(call.call_value ?? 0),
      visible: false,
    },
    'post',
  );

  // The node reports `result: true` even for a reverted call; a revert shows up in `message`.
  if (!simulation?.result?.result || simulation.result.message) {
    const reason = decodeMessage(simulation?.result?.message);
    throw new Error(`Transaction simulation failed${reason ? `: ${reason}` : ''}. Nothing was sent.`);
  }

  return BigInt(simulation.energy_used ?? 0);
}

/** ABI-encodes `approve(spender, amount)` calldata (hex, no 0x). */
function approveCalldata(spender: string, amount: bigint): string {
  const word = (hex: string) => hex.padStart(64, '0');
  return `095ea7b3${word(TronWeb.address.toHex(spender).slice(2))}${word(amount.toString(16))}`;
}

/** Polls until the transaction is in a block; throws if it failed or reverted. */
async function waitForConfirmation(tronWeb: TronWeb, txid: string) {
  console.log(`Transaction submitted: ${txid}`);
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const info = await tronWeb.trx.getTransactionInfo(txid).catch(() => undefined);

    if (info?.blockNumber) {
      const receiptResult = info.receipt?.result;
      if (info.result === 'FAILED' || (receiptResult && receiptResult !== 'SUCCESS')) {
        throw new Error(
          `TRON transaction failed (${receiptResult ?? info.result}) ${decodeMessage(info.resMessage)}. Hash: ${txid}`.trim(),
        );
      }
      return info;
    }

    await delay(CONFIRMATION_POLL_MS);
  }

  throw new Error(`Transaction submitted but not confirmed within ${CONFIRMATION_TIMEOUT_MS / 1000}s. Hash: ${txid}`);
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

  isSameAddress(a, b) {
    try {
      return TronWeb.isAddress(toBase58(a)) && toBase58(a) === toBase58(b);
    } catch {
      return false;
    }
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

  async approve({ chain, privateKey, asset, spender, amount }) {
    const spenderAddress = toBase58(spender);
    if (!TronWeb.isAddress(spenderAddress)) {
      throw new Error(`Invalid TRON spender address: ${spender}`);
    }

    const tronWeb = tronWebFor(chain, privateKey.replace(/^0x/, ''));
    const owner = tronWeb.defaultAddress.base58;
    if (!owner) {
      throw new Error('Unable to determine sender address');
    }

    const contract = await tronWeb.contract(TRC20_ABI, asset.address);
    const allowance = BigInt(String(await contract.allowance(owner, spenderAddress).call()));
    if (allowance >= amount) return false;

    const setAllowance = async (value: bigint) => {
      const txid = await contract.approve(spenderAddress, value.toString()).send({ feeLimit: chain.config.feeLimitSun });
      await waitForConfirmation(tronWeb, String(txid));
    };

    // Same precaution as on EVM: some tokens refuse to change a non-zero allowance to another non-zero value.
    if (allowance > 0n) {
      console.log(`Resetting existing ${asset.symbol} allowance to 0...`);
      await setAllowance(0n);
    }

    console.log(`Approving ${asset.symbol} for ${spenderAddress}...`);
    await setAllowance(amount);
    return true;
  },

  async estimateFees({ chain, owner, asset, amount, spender, transaction: tx, quotedFee }) {
    const tronWeb = tronWebFor(chain);
    tronWeb.setAddress(owner);

    const [resources, balance] = await Promise.all([accountResources(tronWeb, owner), tronWeb.trx.getBalance(owner)]);

    // Staked energy/bandwidth is spent first, across the approval and the bridge call; the rest is burned as TRX.
    // Bandwidth is all-or-nothing per transaction: if the account can't cover the whole size, all of it is burned.
    let energyLeft = resources.energy;
    let bandwidthLeft = resources.bandwidth;
    const burn = (energy: bigint, bytes: bigint) => {
      const energyBurned = energy > energyLeft ? energy - energyLeft : 0n;
      energyLeft = energyLeft > energy ? energyLeft - energy : 0n;
      let bandwidthBurned = 0n;
      if (bytes > bandwidthLeft) bandwidthBurned = bytes;
      else bandwidthLeft -= bytes;
      return energyBurned * resources.energyPrice + bandwidthBurned * resources.bandwidthPrice;
    };

    let approvalTxs = 0;
    let approvalFee = 0n;
    if (asset.kind === 'token' && spender) {
      const spenderAddress = toBase58(spender);
      const contract = await tronWeb.contract(TRC20_ABI, asset.address);
      const allowance = BigInt(String(await contract.allowance(owner, spenderAddress).call()));

      if (allowance < amount) {
        approvalTxs = allowance > 0n ? 2 : 1; // reset to 0 first, then set
        const energy = await simulateEnergy(tronWeb, owner, {
          contract_address: asset.address,
          data: approveCalldata(spenderAddress, amount),
        }).catch(() => 35_000n);
        for (let i = 0; i < approvalTxs; i++) approvalFee += burn(energy, APPROVE_TX_BYTES);
      }
    }

    const unsigned = (tx.customData as { tronTransaction?: UnsignedTronTransaction } | undefined)?.tronTransaction;
    const params = unsigned?.raw_data?.contract?.[0]?.parameter?.value ?? {};
    const callValue = BigInt(params.call_value ?? 0);

    // The bridge call can only be simulated once the allowance is in place; before that, use the router's estimate.
    let transactionFee = quotedFee ?? 0n;
    if (approvalTxs === 0 && unsigned) {
      const energy = await simulateEnergy(tronWeb, owner, params).catch(() => undefined);
      if (energy !== undefined) {
        transactionFee = burn(energy, BigInt(unsigned.raw_data_hex.length / 2) + SIGNED_TX_OVERHEAD_BYTES);
      }
    }

    return {
      approvalFee,
      approvalTxs,
      transactionFee,
      extraValue: asset.kind === 'native' ? (callValue > amount ? callValue - amount : 0n) : callValue,
      nativeBalance: BigInt(balance),
    };
  },

  async sendPreparedTransaction({ chain, privateKey, asset, amount, transaction: tx }) {
    const unsigned = (tx.customData as { tronTransaction?: UnsignedTronTransaction } | undefined)?.tronTransaction;
    const contracts = unsigned?.raw_data?.contract;

    if (!unsigned?.txID || !unsigned.raw_data_hex || !contracts) {
      throw new Error('Prepared transaction does not contain a TRON transaction');
    }
    if (contracts.length !== 1 || contracts[0]?.type !== 'TriggerSmartContract') {
      throw new Error('Prepared TRON transaction must be a single smart-contract call');
    }
    if (tx.data && tx.data.replace(/^0x/, '').toLowerCase() !== unsigned.raw_data_hex.toLowerCase()) {
      throw new Error('Prepared TRON transaction does not match its calldata');
    }

    const expiration = unsigned.raw_data.expiration ?? 0;
    if (expiration < Date.now() + MIN_EXPIRATION_MARGIN_MS) {
      throw new Error('Prepared TRON transaction has expired. Request a new quote.');
    }

    const tronWeb = tronWebFor(chain, privateKey.replace(/^0x/, ''));
    const sender = tronWeb.defaultAddress.base58;
    const params = contracts[0].parameter?.value ?? {};

    if (!sender || !params.owner_address || toBase58(params.owner_address) !== sender) {
      throw new Error(`Prepared TRON transaction is not from this wallet (${sender || 'unknown'})`);
    }
    if (!params.contract_address || (tx.to && toBase58(params.contract_address) !== toBase58(tx.to))) {
      throw new Error('Prepared TRON transaction targets an unexpected contract');
    }

    const callValue = BigInt(params.call_value ?? 0);
    if (tx.value !== undefined && callValue !== BigInt(tx.value)) {
      throw new Error('Prepared TRON transaction value does not match the quote');
    }
    if (asset.kind === 'native' && callValue < amount) {
      throw new Error('Prepared transaction sends less than the requested amount');
    }

    const fmtTrx = (sun: bigint) => `${formatAmount(sun, chain.config.nativeCurrency.decimals)} TRX`;
    const trxBalance = BigInt(await tronWeb.trx.getBalance(sender));
    if (trxBalance < callValue) {
      throw new Error(`Insufficient TRX. Balance: ${fmtTrx(trxBalance)}`);
    }

    if (asset.kind === 'token') {
      const contract = await tronWeb.contract(TRC20_ABI, asset.address);
      const balance = BigInt(String(await contract.balanceOf(sender).call()));
      if (balance < amount) {
        throw new Error(`Insufficient ${asset.symbol}. Balance: ${formatAmount(balance, asset.decimals)} ${asset.symbol}`);
      }
    }

    // Simulate first: a reverting or under-funded call still burns TRX for energy on TRON.
    const energyBurn = await estimateEnergyBurn(tronWeb, sender, params);
    const feeLimit = BigInt((unsigned.raw_data as { fee_limit?: number }).fee_limit ?? 0);
    if (feeLimit > 0n && energyBurn > feeLimit) {
      throw new Error(`Estimated energy cost (${fmtTrx(energyBurn)}) exceeds the transaction fee limit (${fmtTrx(feeLimit)})`);
    }
    if (trxBalance < callValue + energyBurn) {
      throw new Error(
        `Insufficient TRX for value plus estimated energy cost (${fmtTrx(energyBurn)}). Balance: ${fmtTrx(trxBalance)}`,
      );
    }

    // `sign` also verifies the key matches owner_address and that raw_data, raw_data_hex and txID agree.
    const signed = await tronWeb.trx.sign(unsigned as unknown as Types.Transaction);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);

    if (!broadcast.result) {
      const reason = 'message' in broadcast ? decodeMessage(String(broadcast.message)) : '';
      throw new Error(`TRON transaction broadcast failed${reason ? `: ${reason}` : ''}`);
    }

    const info = await waitForConfirmation(tronWeb, unsigned.txID);
    return { chainId: chain.id, transactionHash: unsigned.txID, blockNumber: BigInt(info.blockNumber) };
  },
};
