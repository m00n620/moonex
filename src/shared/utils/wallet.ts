import { TronWeb } from 'tronweb';
import { createPublicClient, http, erc20Abi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { GeneratedWallet } from '../../services/wallets/wallet.types';
import { Wallet } from '../../services/wallets/wallet.model';
import { networkConfig } from '../../config/network';
import { supportedTokensConfig } from '../../config/tokens';

export function generateEthereumWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return {
    network: 'ethereum',
    address: account.address,
    privateKey,
  };
}

export async function generateTronWallet(): Promise<GeneratedWallet> {
  const account = await TronWeb.createAccount();

  return {
    network: 'tron',
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

export async function getWalletPortfolio(wallet: Wallet) {
  if (wallet.network === 'ethereum') {
    const tokens = supportedTokensConfig.ethereum;
    const network = networkConfig.ethereum;
    const publicClient = createPublicClient({
      chain: network.chain,
      transport: http(),
    });

    const result = await publicClient.multicall({
      contracts: tokens.map(
        (token) =>
          ({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [wallet.address],
          }) as any,
      ),
    });

    console.log(result);
  }
}
