import { password, select, input } from "@inquirer/prompts";
import { walletRepository } from "../database/wallet.repository";

export async function createWallet() {
  console.log("Creating a new wallet...");

  const walletName = await input({
    message: "Enter a name for the new wallet:",
  }); 

  const walletPassword = await password({
    message: "Enter a password for the new wallet:",
    mask: "*",
  });

  const network = await select({
    message: "Select a network:",
    choices: [
      { name: "Ethereum", value: "ethereum" },
      { name: "Tron", value: "tron" },
    ],
  });

  await walletRepository.create({
    name: walletName,
    password: walletPassword,
    network,
  });
}
