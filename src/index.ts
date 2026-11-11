import { select } from '@inquirer/prompts';
import { connectDatabase, disconnectDatabase } from './config/database';
import { WalletService } from './services/wallets/wallet.service';

const isPromptExit = (error: unknown) => error instanceof Error && error.name === 'ExitPromptError';

async function main() {
  await connectDatabase();
  console.log('Database connected successfully.');

  const wallets = new WalletService();
  const actions = {
    create: () => wallets.createWallet(),
    list: () => wallets.listWallets(),
    load: () => wallets.loadWallet(),
    send: () => wallets.sendTransaction(),
  };

  while (true) {
    const answer = await select<keyof typeof actions | 'exit'>({
      message: 'Select an option:',
      choices: [
        { name: 'Create a new wallet', value: 'create' },
        { name: 'List all wallets', value: 'list' },
        { name: 'Load wallet (balances)', value: 'load' },
        { name: 'Send transaction', value: 'send' },
        { name: 'Exit', value: 'exit' },
      ],
    });

    if (answer === 'exit') return;

    try {
      await actions[answer]();
    } catch (error) {
      if (isPromptExit(error)) throw error;
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main()
  .catch((error) => {
    if (!isPromptExit(error)) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  })
  .finally(() => disconnectDatabase());
