import { TronWeb } from 'tronweb';
import { createPublicClient, http, erc20Abi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { GeneratedWallet } from '../../services/wallets/wallet.types';
import { Wallet } from '../../services/wallets/wallet.model';
import { networkConfig } from '../../config/network';
import { supportedTokensConfig } from '../../config/tokens';
import { Chain, isEvmChain } from '../types';

export function generateEvmWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    privateKey,
  };
}

export async function generateTronWallet(): Promise<GeneratedWallet> {
  const account = await TronWeb.createAccount();

  return {
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

export async function getWalletPortfolio(wallet: Wallet, chain: Chain) {
  if (isEvmChain(chain)) {
    const tokens = supportedTokensConfig[chain];
    const network = networkConfig[chain];

    const publicClient = createPublicClient({
      chain: network.chain,
      transport: http(network.rpcUrl),
    });

    const contracts = tokens
      .filter((token) => !token.isNative)
      .map(
        (token) =>
          ({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [wallet.address],
          }) as any,
      );

    const result = await publicClient.multicall({ contracts });

    console.log(result);
  }
}
