import type { Asset, ChainConfig } from '../config/chain.types';
import type { ChainId } from '../config/chains';

export interface GeneratedWallet {
  address: string;
  privateKey: string;
}

export interface ChainContext<C extends ChainConfig = ChainConfig> {
  id: ChainId;
  config: C;
  rpcUrl: string;
}

export interface AssetBalance {
  asset: Asset;
  /** Balance in base units, or an error message if the lookup failed. */
  balance: bigint | { error: string };
}

export interface TransferRequest<C extends ChainConfig = ChainConfig> {
  chain: ChainContext<C>;
  privateKey: string;
  to: string;
  asset: Asset;
  /** Amount in the asset's base units; always > 0. */
  amount: bigint;
}

export interface TransferResult {
  chainId: ChainId;
  transactionHash: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
}

/**
 * A contract call built by a third party (e.g. a bridge router), ready to sign.
 * Numeric fields are hex or decimal strings, as returned by the router API.
 */
export interface PreparedTransaction {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  from?: string;
  chainId?: number;
  /** Network-specific payload, e.g. `{ tronTransaction }` for TRON. */
  customData?: unknown;
}

export interface ApprovalRequest<C extends ChainConfig = ChainConfig> {
  chain: ChainContext<C>;
  privateKey: string;
  asset: Extract<Asset, { kind: 'token' }>;
  /** Contract allowed to pull the tokens. */
  spender: string;
  /** Exact allowance needed, in base units. Never approves more than this. */
  amount: bigint;
}

export interface PreparedTransactionRequest<C extends ChainConfig = ChainConfig> {
  chain: ChainContext<C>;
  privateKey: string;
  /** The asset and amount the transaction spends; checked against the sender's balance before submitting. */
  asset: Asset;
  amount: bigint;
  transaction: PreparedTransaction;
}

export interface FeeEstimateRequest<C extends ChainConfig = ChainConfig> {
  chain: ChainContext<C>;
  /** Address that will approve and send. */
  owner: string;
  asset: Asset;
  amount: bigint;
  /** Contract to approve; undefined when no approval is needed. */
  spender?: string | undefined;
  transaction: PreparedTransaction;
  /** The router's own fee estimate for the transaction, in native base units (fallback when it can't be simulated). */
  quotedFee?: bigint | undefined;
}

/** Native-coin costs of approving and sending a prepared transaction, all in base units. */
export interface FeeEstimate {
  /** Fee for the approval transaction(s); 0 when the current allowance already covers the amount. */
  approvalFee: bigint;
  approvalTxs: number;
  /** Fee the wallet must be able to cover for the main transaction (the same figure the pre-send balance check uses). */
  transactionFee: bigint;
  /** Native coin sent with the transaction on top of the amount (e.g. a bridge fee paid in native). */
  extraValue: bigint;
  nativeBalance: bigint;
}

/** Everything the app needs from a network family. One implementation per entry in `NETWORKS`. */
export interface NetworkAdapter<C extends ChainConfig = ChainConfig> {
  /** Label shown when choosing a network for a new wallet. */
  label: string;
  generateWallet(): Promise<GeneratedWallet>;
  isValidAddress(address: string): boolean;
  /** Compares two addresses of this network, ignoring representation differences (case, hex vs base58). */
  isSameAddress(a: string, b: string): boolean;
  getBalances(chain: ChainContext<C>, address: string): Promise<AssetBalance[]>;
  transfer(request: TransferRequest<C>): Promise<TransferResult>;
  /** Ensures `spender` may pull `amount` of the token; waits for the approval to confirm. Returns true if a transaction was sent. */
  approve(request: ApprovalRequest<C>): Promise<boolean>;
  /** Estimates the native coin needed to approve (if required) and send a prepared transaction. Signs nothing. */
  estimateFees(request: FeeEstimateRequest<C>): Promise<FeeEstimate>;
  /** Verifies, signs, submits and confirms a prepared contract call. */
  sendPreparedTransaction(request: PreparedTransactionRequest<C>): Promise<TransferResult>;
}
