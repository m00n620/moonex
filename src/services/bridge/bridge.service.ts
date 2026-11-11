import { setTimeout as delay } from 'node:timers/promises';
import type { Asset } from '../../config/chain.types';
import { type ChainId } from '../../config/chains';
import {
  getAdapter,
  getChainContext,
  type ChainContext,
  type FeeEstimate,
  type PreparedTransaction,
  type TransferResult,
} from '../../networks';
import { formatAmount } from '../../shared/utils/amount';
import { getQuote, getStatus, NATIVE_TOKEN_ADDRESSES, type LifiQuote, type LifiStatus } from './lifi.client';

/** Default slippage tolerance: 0.5%. */
export const DEFAULT_SLIPPAGE = 0.005;
/** LI.FI quotes are valid for about a minute; anything older is refreshed before sending. */
const QUOTE_MAX_AGE_MS = 45_000;
const STATUS_POLL_MS = 10_000;
const DEFAULT_TRACK_TIMEOUT_MS = 30 * 60_000;

export interface BridgeRequest {
  fromChainId: ChainId;
  fromAsset: Asset;
  toChainId: ChainId;
  toAsset: Asset;
  /** Base units of `fromAsset`; always > 0. */
  amount: bigint;
  fromAddress: string;
  /** Recipient on the destination chain: one of the user's wallets or a pasted address. */
  toAddress: string;
  slippage: number;
}

export interface BridgeQuote {
  request: BridgeRequest;
  quote: LifiQuote;
  transaction: PreparedTransaction;
  /** Contract to approve before sending; undefined for native coins. */
  spender?: string | undefined;
  quotedAt: number;
}

export interface BridgeResult extends TransferResult {
  tool: string;
}

/** Requests a route and verifies it matches the request exactly before anything is signed. */
export async function quoteBridge(request: BridgeRequest): Promise<BridgeQuote> {
  const from = getChainContext(request.fromChainId);
  const to = getChainContext(request.toChainId);

  if (request.fromChainId === request.toChainId) {
    throw new Error('Source and destination chains must differ. Use "Send transaction" for same-chain transfers.');
  }
  if (request.amount <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  if (!getAdapter(from.config.network).isValidAddress(request.fromAddress)) {
    throw new Error(`Invalid sender address for ${from.config.name}`);
  }
  if (!getAdapter(to.config.network).isValidAddress(request.toAddress)) {
    throw new Error(`Invalid recipient address for ${to.config.name}`);
  }

  const quote = await getQuote({
    fromChain: from.config.chainId,
    toChain: to.config.chainId,
    fromToken: routerTokenAddress(from, request.fromAsset),
    toToken: routerTokenAddress(to, request.toAsset),
    fromAmount: request.amount,
    fromAddress: request.fromAddress,
    toAddress: request.toAddress,
    slippage: request.slippage,
  });

  return { request, quote, ...verifyQuote(request, quote, from, to), quotedAt: Date.now() };
}

function routerTokenAddress(chain: ChainContext, asset: Asset): string {
  return asset.kind === 'native' ? NATIVE_TOKEN_ADDRESSES[chain.config.network][0]! : asset.address;
}

function isToken(chain: ChainContext, asset: Asset, address: string): boolean {
  const adapter = getAdapter(chain.config.network);
  if (asset.kind === 'token') return adapter.isSameAddress(asset.address, address);
  return NATIVE_TOKEN_ADDRESSES[chain.config.network].some((native) => adapter.isSameAddress(native, address));
}

/**
 * The quote comes from a third party and decides where funds go, so every field that matters
 * is checked against what the user asked for. Any mismatch aborts before signing.
 */
function verifyQuote(
  request: BridgeRequest,
  quote: LifiQuote,
  from: ChainContext,
  to: ChainContext,
): { transaction: PreparedTransaction; spender?: string | undefined } {
  const { action, estimate, transactionRequest: tx } = quote;
  const fromAdapter = getAdapter(from.config.network);
  const toAdapter = getAdapter(to.config.network);
  const fail: (what: string) => never = (what) => {
    throw new Error(`Bridge quote rejected: ${what} does not match your request. Nothing was sent.`);
  };

  if (!action || !estimate || !tx) fail('quote structure');
  if (action.fromChainId !== from.config.chainId) fail('source chain');
  if (action.toChainId !== to.config.chainId) fail('destination chain');
  if (action.fromAmount !== request.amount.toString()) fail('amount');
  if (!fromAdapter.isSameAddress(action.fromAddress, request.fromAddress)) fail('sender');
  if (!toAdapter.isSameAddress(action.toAddress, request.toAddress)) fail('recipient');
  if (!isToken(from, request.fromAsset, action.fromToken.address)) fail('source asset');
  if (!isToken(to, request.toAsset, action.toToken.address)) fail('destination asset');
  if (action.toToken.decimals !== request.toAsset.decimals) fail('destination asset decimals');
  if (tx.from && !fromAdapter.isSameAddress(tx.from, request.fromAddress)) fail('transaction sender');

  const toAmountMin = BigInt(estimate.toAmountMin || 0);
  if (toAmountMin <= 0n || toAmountMin > BigInt(estimate.toAmount || 0)) fail('minimum received amount');

  let spender: string | undefined;
  if (request.fromAsset.kind === 'token' && !estimate.skipApproval) {
    if (!estimate.approvalAddress) fail('approval address (missing)');
    // Only ever approve the contract the transaction actually calls.
    if (!fromAdapter.isSameAddress(estimate.approvalAddress, tx.to)) fail('approval address');
    spender = estimate.approvalAddress;
  }

  return { transaction: tx, spender };
}

/**
 * Approves (token sources only) and submits the bridge transaction on the source chain.
 * A quote older than QUOTE_MAX_AGE_MS is refreshed first and must still deliver at least
 * the minimum the user confirmed.
 */
export async function executeBridge(confirmed: BridgeQuote, privateKey: string): Promise<BridgeResult> {
  const { request } = confirmed;
  const chain = getChainContext(request.fromChainId);
  const adapter = getAdapter(chain.config.network);

  if (request.fromAsset.kind === 'token' && confirmed.spender) {
    await adapter.approve({
      chain,
      privateKey,
      asset: request.fromAsset,
      spender: confirmed.spender,
      amount: request.amount,
    });
  }

  let current = confirmed;
  if (Date.now() - current.quotedAt > QUOTE_MAX_AGE_MS) {
    console.log('Quote expired; requesting a fresh one...');
    current = await quoteBridge(request);

    const confirmedMin = BigInt(confirmed.quote.estimate.toAmountMin);
    if (BigInt(current.quote.estimate.toAmount) < confirmedMin) {
      throw new Error(
        'The refreshed quote is below the minimum you confirmed, so nothing was bridged. Run the bridge again to review it.',
      );
    }
    if (current.spender && (!confirmed.spender || !adapter.isSameAddress(current.spender, confirmed.spender))) {
      throw new Error('The refreshed quote uses a different contract than the one approved, so nothing was bridged. Run the bridge again.');
    }
  }

  const result = await adapter.sendPreparedTransaction({
    chain,
    privateKey,
    asset: request.fromAsset,
    amount: request.amount,
    transaction: current.transaction,
  });

  return { ...result, tool: current.quote.tool };
}

/** Polls the transfer until it is DONE or FAILED, calling `onUpdate` whenever the status changes. */
export async function trackBridge(
  params: { txHash: string; fromChainId?: ChainId; toChainId?: ChainId; tool?: string },
  onUpdate: (status: LifiStatus) => void,
  timeoutMs = DEFAULT_TRACK_TIMEOUT_MS,
): Promise<LifiStatus> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let status: LifiStatus = { status: 'NOT_FOUND' };

  while (Date.now() < deadline) {
    try {
      status = await getBridgeStatus(params);
    } catch (error) {
      // Transient API errors shouldn't end tracking; the transfer is already on-chain.
      console.log(`Status check failed, retrying: ${error instanceof Error ? error.message : String(error)}`);
    }

    const key = `${status.status}/${status.substatus ?? ''}`;
    if (key !== last) {
      last = key;
      onUpdate(status);
    }

    if (status.status === 'DONE' || status.status === 'FAILED' || status.status === 'INVALID') return status;
    await delay(STATUS_POLL_MS);
  }

  return status;
}

export function getBridgeStatus(params: { txHash: string; fromChainId?: ChainId; toChainId?: ChainId; tool?: string }) {
  return getStatus({
    txHash: params.txHash,
    fromChain: params.fromChainId ? getChainContext(params.fromChainId).config.chainId : undefined,
    toChain: params.toChainId ? getChainContext(params.toChainId).config.chainId : undefined,
    bridge: params.tool,
  });
}

export function explorerLink(txHash: string): string {
  return `https://scan.li.fi/tx/${txHash}`;
}

/* -------------------------------- Display --------------------------------- */

const usd = (value: number) => `$${value.toFixed(2)}`;
const sumUsd = (costs: { amountUSD?: string }[] = []) => costs.reduce((sum, cost) => sum + Number(cost.amountUSD ?? 0), 0);

/**
 * Human-readable quote summary. Amounts are deliberately expressed as percentages and fees,
 * never as absolute token amounts, matching how the CLI keeps amounts off-screen.
 */
export function describeQuote({ quote, request }: BridgeQuote): string[] {
  const { estimate } = quote;
  const lines = [`Route:          ${quote.toolDetails?.name ?? quote.tool}`];

  const fromUsd = Number(estimate.fromAmountUSD ?? 0);
  const toUsd = Number(estimate.toAmountUSD ?? 0);
  if (fromUsd > 0 && toUsd > 0) {
    const minRatio = Number(BigInt(estimate.toAmountMin) * 1_000_000n / BigInt(estimate.toAmount)) / 1_000_000;
    const expected = (toUsd / fromUsd) * 100;
    lines.push(`You receive:    ~${expected.toFixed(2)}% of the value sent (at least ${(expected * minRatio).toFixed(2)}%)`);
  } else {
    lines.push('You receive:    value estimate unavailable for this route');
  }

  lines.push(`Slippage:       ${(request.slippage * 100).toFixed(2)}% max`);

  // Bridge/protocol fees deducted from the amount, itemised.
  const deducted = (estimate.feeCosts ?? []).filter((fee) => fee.included !== false);
  const deductedUsd = sumUsd(deducted);
  if (deducted.length > 0) {
    const pct = deducted.reduce((sum, fee) => sum + Number(fee.percentage ?? 0), 0) * 100;
    lines.push(`Bridge fees:    ~${usd(deductedUsd)}${pct > 0 ? ` (${pct.toFixed(2)}%)` : ''}, deducted from the amount`);
    for (const fee of deducted) {
      const feePct = Number(fee.percentage ?? 0) * 100;
      lines.push(`                  ${fee.name ?? 'Fee'}: ${usd(Number(fee.amountUSD ?? 0))}${feePct > 0 ? ` (${feePct.toFixed(2)}%)` : ''}`);
    }
  } else {
    lines.push('Bridge fees:    none itemised by this route');
  }

  const extraFees = sumUsd(estimate.feeCosts?.filter((fee) => fee.included === false));
  if (extraFees > 0) lines.push(`Extra fees:     ~${usd(extraFees)} (paid on top, in the source chain's native coin)`);

  // Value lost beyond the itemised fees: exchange rate, or delivery costs priced into the route.
  if (fromUsd > 0 && toUsd > 0) {
    const unexplained = fromUsd - toUsd - deductedUsd;
    if (unexplained > fromUsd * 0.005) {
      lines.push(
        `Other costs:    ~${usd(unexplained)} (${((unexplained / fromUsd) * 100).toFixed(2)}%), exchange rate / delivery cost not itemised by the route`,
      );
    }
  }

  if (estimate.executionDuration) {
    const minutes = Math.max(1, Math.round(estimate.executionDuration / 60));
    lines.push(`Estimated time: ~${minutes} min`);
  }

  return lines;
}

/* ------------------------------- Gas estimate ------------------------------ */

export interface BridgeGasEstimate {
  source: FeeEstimate & {
    chainName: string;
    network: ChainContext['config']['network'];
    native: { symbol: string; decimals: number };
    /** USD price of the source chain's native coin, when the router provides one. */
    priceUsd?: number | undefined;
    /** Approval + transaction fee + native value sent on top of the amount. */
    totalFee: bigint;
    /** Expected (not worst-case) transaction fee, for cost totals. */
    expectedTransactionFee: bigint;
    /** Balance of the asset being bridged (equals nativeBalance for native coins). */
    assetBalance: bigint;
    enoughGas: boolean;
    enoughAsset: boolean;
  };
  destination: {
    chainName: string;
    native: { symbol: string; decimals: number };
    /** Recipient's native balance on the destination chain; undefined if it couldn't be read. */
    recipientBalance?: bigint | undefined;
  };
}

/** Native coin needed on the source chain (and what the recipient has on the destination). Signs nothing. */
export async function estimateBridgeGas({ request, quote, transaction, spender }: BridgeQuote): Promise<BridgeGasEstimate> {
  const from = getChainContext(request.fromChainId);
  const to = getChainContext(request.toChainId);
  const fromNative = from.config.nativeCurrency;
  const nativeAsset: Asset = { kind: 'native', ...fromNative };

  // The router's gas estimate, counting only costs paid in the source chain's native coin.
  const nativeGasCosts = (quote.estimate.gasCosts ?? []).filter((cost) => isToken(from, nativeAsset, cost.token.address));
  const quotedFee = nativeGasCosts.length ? nativeGasCosts.reduce((sum, cost) => sum + BigInt(cost.amount || 0), 0n) : undefined;
  const priceUsd = Number(
    nativeGasCosts[0]?.token.priceUSD ?? (request.fromAsset.kind === 'native' ? quote.action.fromToken.priceUSD : undefined) ?? 0,
  );

  const [fees, sourceBalances, recipientBalance] = await Promise.all([
    getAdapter(from.config.network).estimateFees({
      chain: from,
      owner: request.fromAddress,
      asset: request.fromAsset,
      amount: request.amount,
      spender,
      transaction,
      quotedFee,
    }),
    request.fromAsset.kind === 'token'
      ? getAdapter(from.config.network).getBalances(from, request.fromAddress)
      : Promise.resolve(undefined),
    getAdapter(to.config.network)
      .getBalances(to, request.toAddress)
      .then((balances) => balances.find((b) => b.asset.kind === 'native')?.balance)
      .then((balance) => (typeof balance === 'bigint' ? balance : undefined))
      .catch(() => undefined),
  ]);

  let assetBalance = fees.nativeBalance;
  if (request.fromAsset.kind === 'token') {
    const symbol = request.fromAsset.symbol;
    const entry = sourceBalances?.find((b) => b.asset.symbol === symbol)?.balance;
    if (typeof entry !== 'bigint') throw new Error(`Could not read your ${symbol} balance on ${from.config.name}`);
    assetBalance = entry;
  }

  const totalFee = fees.approvalFee + fees.transactionFee + fees.extraValue;
  const nativeNeeded = totalFee + (request.fromAsset.kind === 'native' ? request.amount : 0n);
  // EVM's transactionFee is a worst case (gas limit × max fee); the router's estimate is the expected cost.
  const expectedTransactionFee =
    from.config.network === 'evm' && quotedFee !== undefined && quotedFee < fees.transactionFee ? quotedFee : fees.transactionFee;

  return {
    source: {
      ...fees,
      chainName: from.config.name,
      network: from.config.network,
      native: fromNative,
      priceUsd: priceUsd > 0 ? priceUsd : undefined,
      totalFee,
      expectedTransactionFee,
      assetBalance,
      enoughGas: fees.nativeBalance >= nativeNeeded,
      enoughAsset: assetBalance >= request.amount,
    },
    destination: { chainName: to.config.name, native: to.config.nativeCurrency, recipientBalance },
  };
}

/** Rounds a base-unit amount to a few significant digits for display, e.g. 0.00002145 ETH. */
function formatNative(value: bigint, native: { symbol: string; decimals: number }): string {
  const number = Number(formatAmount(value, native.decimals));
  return `${number.toLocaleString('en-US', { maximumSignificantDigits: 4 })} ${native.symbol}`;
}

/** Gas summary for both chains, plus total cost. Absolute bridged amounts are never shown. */
export function describeGas({ quote, request }: BridgeQuote, gas: BridgeGasEstimate): string[] {
  const { source, destination } = gas;
  const toUsd = (value: bigint) =>
    source.priceUsd ? ` (~${usd(Number(formatAmount(value, source.native.decimals)) * source.priceUsd)})` : '';
  const fmt = (value: bigint) => `${formatNative(value, source.native)}${toUsd(value)}`;
  const isNative = request.fromAsset.kind === 'native';

  const lines = [`Gas on ${source.chainName} (source, paid in ${source.native.symbol} by the sending wallet):`];

  if (!isNative) {
    lines.push(
      source.approvalTxs === 0
        ? '  Approval:      not needed (already approved)'
        : `  Approval:      ${fmt(source.approvalFee)}${source.approvalTxs === 2 ? ', 2 transactions (reset to 0, then approve)' : ''}`,
    );
  }

  const ceiling = source.network === 'evm';
  lines.push(`  Bridge tx:     ${ceiling ? 'up to ' : '~'}${fmt(source.transactionFee)}`);
  if (ceiling && source.expectedTransactionFee < source.transactionFee) {
    lines.push(`                 usually ~${fmt(source.expectedTransactionFee)}; you're only charged for gas actually used`);
  }
  if (source.extraValue > 0n) {
    lines.push(`  Bridge fee:    ${fmt(source.extraValue)}, sent with the transaction`);
  }

  lines.push(`  Total needed:  ${fmt(source.totalFee)}${isNative ? ` on top of the ${source.native.symbol} you're bridging` : ''}`);

  if (isNative) {
    // Don't show balance minus amount: that would reveal the amount.
    lines.push(
      source.enoughGas
        ? `  Wallet:        enough ${source.native.symbol} for the amount plus gas ✓`
        : `  Wallet:        NOT enough ${source.native.symbol} for the amount plus gas ✗`,
    );
  } else {
    const shortBy = source.totalFee - source.nativeBalance;
    lines.push(
      source.enoughGas
        ? `  Wallet has:    ${formatNative(source.nativeBalance, source.native)} ✓`
        : `  Wallet has:    ${formatNative(source.nativeBalance, source.native)} ✗ short by ${formatNative(shortBy, source.native)}`,
    );
    if (!source.enoughAsset) lines.push(`  Wallet:        NOT enough ${request.fromAsset.symbol} for this amount ✗`);
  }

  lines.push(`Gas on ${destination.chainName} (destination):`);
  lines.push('  To receive:    nothing, the bridge pays delivery gas (its cost is in the fees above)');
  if (destination.recipientBalance !== undefined) {
    const has = formatNative(destination.recipientBalance, destination.native);
    lines.push(
      destination.recipientBalance > 0n
        ? `  Recipient has: ${has}`
        : `  Recipient has: 0 ${destination.native.symbol}, they'll need ${destination.native.symbol} for gas to move the ${request.toAsset.symbol} later`,
    );
  }

  const fromUsd = Number(quote.estimate.fromAmountUSD ?? 0);
  const receivedUsd = Number(quote.estimate.toAmountUSD ?? 0);
  if (fromUsd > 0 && receivedUsd > 0 && source.priceUsd) {
    const gasUsd =
      Number(formatAmount(source.approvalFee + source.expectedTransactionFee + source.extraValue, source.native.decimals)) *
      source.priceUsd;
    // Itemised fees are a floor: token price differences between chains can otherwise hide them.
    const feesUsd = sumUsd(quote.estimate.feeCosts);
    const total = Math.max(fromUsd - receivedUsd, feesUsd, 0) + gasUsd;
    lines.push(`Total cost:      ~${usd(total)} (fees + other costs + gas)`);
  }

  return lines;
}
