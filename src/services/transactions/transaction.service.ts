import { sendEvm } from './evm.adapter';
import { sendTron } from './tron.adapter';
import type { TransferResult } from './transaction.types';
import { Chain, isEvmChain } from '../../shared/types';
import { supportedTokensConfig } from '../../config/tokens';

export async function sendTransfer(input: {
  privateKey: string;
  to: string;
  amount: string;
  token: string;
  chain: Chain;
}): Promise<TransferResult> {
  const { privateKey, to, amount, chain } = input;

  const token = supportedTokensConfig[chain].find((token) => token.symbol == input.token);

  if (!token) {
    throw new Error(`Token ${input.token} is not configured for ${chain}`);
  }

  const transfer = {
    privateKey,
    to,
    amount,
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    assetType: token.isNative ? 'native' : 'token',
  } as const;

  if (isEvmChain(chain)) {
    return sendEvm({ ...transfer, chain });
  }

  return sendTron({ ...transfer, chain });
}
