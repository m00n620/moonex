import { walletRepository } from "../database/wallet.repository";

export async function listWallets() {
  const wallets = await walletRepository.findAll();

  if (wallets.length === 0) {
    console.log("No wallets found.");
    return;
  }

  console.log("Wallets:");
  wallets.forEach((wallet: any) => {
    console.log(`- ID: ${wallet.id}, Name: ${wallet.name}, Network: ${wallet.network}, Address: ${wallet.address}`);
  });
}
