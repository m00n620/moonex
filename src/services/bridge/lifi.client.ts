import type { Network } from '../../config/chain.types';
import { getEnv } from '../../config/env';
import type { PreparedTransaction } from '../../networks';

/**
 * Minimal client for the LI.FI aggregation API (https://docs.li.fi), which routes cross-chain
 * transfers through many bridges and returns ready-to-sign transactions for EVM chains and TRON.
 *
 * No API key is required; set LIFI_API_KEY for higher rate limits.
 */
const BASE_URL = 'https://li.quest/v1';
const REQUEST_TIMEOUT_MS = 30_000;

/** LI.FI's placeholder address for each network family's native coin. */
export const NATIVE_TOKEN_ADDRESSES: Record<Network, readonly string[]> = {
  evm: ['0x0000000000000000000000000000000000000000', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'],
  tron: ['T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'],
};

export interface LifiToken {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  priceUSD?: string;
}

export interface LifiCost {
  name?: string;
  amount: string;
  amountUSD?: string;
  /** For fee costs: fraction of the transferred amount, e.g. "0.0025" for 0.25%. */
  percentage?: string;
  /** For fee costs: true when the fee is deducted from the transferred amount, false when paid on top. */
  included?: boolean;
  token: LifiToken;
}

export interface LifiQuote {
  id: string;
  tool: string;
  toolDetails?: { name?: string };
  action: {
    fromChainId: number;
    toChainId: number;
    fromAmount: string;
    fromAddress: string;
    toAddress: string;
    fromToken: LifiToken;
    toToken: LifiToken;
    slippage?: number;
  };
  estimate: {
    approvalAddress?: string;
    skipApproval?: boolean;
    fromAmount?: string;
    toAmount: string;
    toAmountMin: string;
    fromAmountUSD?: string;
    toAmountUSD?: string;
    /** Seconds. */
    executionDuration?: number;
    feeCosts?: LifiCost[];
    gasCosts?: LifiCost[];
  };
  transactionRequest?: PreparedTransaction;
}

export interface QuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  /** Base units of the source token. */
  fromAmount: bigint;
  fromAddress: string;
  toAddress: string;
  /** Decimal fraction, e.g. 0.005 for 0.5%. */
  slippage: number;
}

export type LifiTransferStatus = 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED';

export interface LifiStatus {
  status: LifiTransferStatus;
  /** E.g. COMPLETED, PARTIAL or REFUNDED when DONE. */
  substatus?: string;
  substatusMessage?: string;
  tool?: string;
  lifiExplorerLink?: string;
  sending?: { txHash?: string; txLink?: string; chainId?: number };
  receiving?: { txHash?: string; txLink?: string; chainId?: number; token?: LifiToken };
}

export class LifiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'LifiError';
  }
}

async function request<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  const apiKey = getEnv('LIFI_API_KEY');
  if (apiKey) headers['x-lifi-api-key'] = apiKey;

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`Bridge API request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = (await response.json().catch(() => undefined)) as { message?: string; code?: number } | undefined;

  if (!response.ok) {
    throw new LifiError(body?.message ?? `Bridge API returned HTTP ${response.status}`, response.status, body?.code);
  }

  return body as T;
}

export function getQuote(params: QuoteParams): Promise<LifiQuote> {
  return request<LifiQuote>('/quote', {
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount.toString(),
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: params.slippage,
    integrator: getEnv('LIFI_INTEGRATOR') || undefined,
  });
}

/** Status of a cross-chain transfer by its source-chain transaction hash. An unindexed hash reports NOT_FOUND. */
export async function getStatus(params: {
  txHash: string;
  fromChain?: number | undefined;
  toChain?: number | undefined;
  bridge?: string | undefined;
}): Promise<LifiStatus> {
  try {
    return await request<LifiStatus>('/status', params);
  } catch (error) {
    if (error instanceof LifiError && error.httpStatus === 404) {
      return { status: 'NOT_FOUND' };
    }
    throw error;
  }
}
