import { select } from "@inquirer/prompts";
import { walletRepository } from "../database/wallet.repository";
import { getWalletPortfolio } from "../shared/utils/wallet";
import { Wallet } from "../types/wallet.types";

export async function loadWallet() {
  const wallets = (await walletRepository.findAll()) as Wallet[];

  if (wallets.length === 0) {
    console.log("No wallets found. Please create a wallet first.");
    return;
  }

  const walletId = await select({
    message: "Select a wallet to fund:",
    choices: wallets.map((wallet) => ({
      name: `${wallet.name}`,
      value: wallet.id,
    })),
  });

  const selectedWallet = wallets.find((wallet) => wallet.id === walletId);

  if (!selectedWallet) {
    console.log("Selected wallet not found.");
    return;
  }

  console.log(`To fund the wallet, please send funds to the following address: ${selectedWallet.address} on ${selectedWallet.network}`);

  const portfolio = await getWalletPortfolio(selectedWallet);
}
