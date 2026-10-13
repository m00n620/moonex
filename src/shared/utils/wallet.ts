import { Wallet as EthersWallet } from "ethers";
import { TronWeb } from "tronweb";
import { createPublicClient, http } from "viem";
import erc20Abi from "../../shared/abis/erc20.json";
import { GeneratedWallet, Wallet } from "../../types/wallet.types";
import { supportedTokensConfig, networkConfig } from "../../configs";

export function generateEthereumWallet(): GeneratedWallet {
  const wallet = EthersWallet.createRandom();

  return {
    network: "ethereum",
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

export async function generateTronWallet(): Promise<GeneratedWallet> {
  const account = await TronWeb.createAccount();

  return {
    network: "tron",
    address: account.address.base58,
    privateKey: account.privateKey,
  };
}

export async function getWalletPortfolio(wallet: Wallet) {
  if (wallet.network === "ethereum") {
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
            functionName: "balanceOf",
            args: [wallet.address],
          }) as any,
      ),
    });

    console.log(result);
  }
}
