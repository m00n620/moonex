import { Wallet as EthersWallet } from 'ethers';
import { TronWeb } from 'tronweb';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import erc20Abi from '../abis/erc20.json';
import { GeneratedWallet, WalletNetwork } from '../../services/wallets/wallet.types';
import { Wallet } from '../../services/wallets/wallet.model';
import { networkConfig } from '../../config/network';
import { supportedTokensConfig } from '../../config/tokens';

export function generateEthereumWallet(): GeneratedWallet {
  const wallet = EthersWallet.createRandom();

  return {
    network: 'ethereum',
    address: wallet.address,
    privateKey: wallet.privateKey,
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

export async function sendToken(input: {
  privateKey: string;
  to: string;
  amount: string;
  token: string;
  network: WalletNetwork;
}) {
  const { privateKey, to, amount, token, network } = input;

  console.log(to, amount, token, network);

  const walletClient = createWalletClient({
    chain: networkConfig[input.network].chain,
    transport: http(networkConfig[input.network].rpcUrl),
  });

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  console.log(account);
  console.log(walletClient);
}
