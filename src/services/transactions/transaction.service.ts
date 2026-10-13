import { sendTron } from './tron.adapter';
import type { TransferResult } from './transaction.types';
import { Network } from '../../shared/types';
import { supportedTokensConfig } from '../../config/tokens';

export async function sendTransfer(input: {
  privateKey: string;
  to: string;
  amount: string;
  token: string;
  network: Network;
}): Promise<TransferResult | null> {
  const { privateKey, to, amount, network } = input;

  const token = supportedTokensConfig[network].find((token) => token.symbol == input.token);

  if (!token) {
    throw 'Token not defined';
  }

  if (network === 'tron') {
    const result = await sendTron({
      network,
      privateKey,
      to,
      amount,
      tokenAddress: token.address,
      assetType: token.isNative ? 'native' : 'token',
    });

    return result;
  }

  return null;
}
