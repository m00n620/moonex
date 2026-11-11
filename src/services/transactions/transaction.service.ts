import { findAsset, type ChainId } from '../../config/chains';
import { getAdapter, getChainContext, type TransferResult } from '../../networks';
import { parseAmount } from '../../shared/utils/amount';

export interface SendTransferInput {
  chainId: ChainId;
  assetSymbol: string;
  to: string;
  /** Human-readable decimal amount, e.g. "12.5". */
  amount: string;
  privateKey: string;
}

export async function sendTransfer(input: SendTransferInput): Promise<TransferResult> {
  const chain = getChainContext(input.chainId);
  const asset = findAsset(input.chainId, input.assetSymbol);

  if (!asset) {
    throw new Error(`${input.assetSymbol} is not configured on ${chain.config.name}`);
  }

  const amount = parseAmount(input.amount, asset.decimals);
  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero');
  }

  return getAdapter(chain.config.network).transfer({
    chain,
    asset,
    amount,
    to: input.to.trim(),
    privateKey: input.privateKey,
  });
}
