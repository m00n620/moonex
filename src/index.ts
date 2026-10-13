import { select } from '@inquirer/prompts';
import { connectDatabase } from './config/database';
import { WalletService } from './services/wallets/wallet.service';

connectDatabase().then(async () => {
  console.log('Database connected successfully.');

  const wallets = new WalletService();

  while (true) {
    const answer = await select({
      message: 'Select an option:',
      choices: [
        { name: 'Create a new wallet', value: 'create' },
        { name: 'List all wallets', value: 'list' },
        { name: 'Load wallet', value: 'load' },
        { name: 'Send transaction', value: 'send' },
        { name: 'Exit', value: 'exit' },
      ],
    });

    if (answer === 'create') {
      await wallets.createWallet();
    } else if (answer === 'list') {
      await wallets.listWallets();
    } else if (answer === 'load') {
      await wallets.loadWallet();
    } else if (answer === 'send') {
      await wallets.sendTransaction();
    } else if (answer === 'exit') {
      console.log('Exiting the application.');
      process.exit();
      break;
    } else {
      console.log('Invalid option selected.');
    }
  }
});
