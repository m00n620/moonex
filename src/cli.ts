import { select } from '@inquirer/prompts'
import { createWallet } from './scripts/wallet.create';
import { listWallets } from './scripts/wallet.list';
import { loadWallet } from './scripts/wallet.load';

select({
  message: 'Select an option:',
  choices: [
    { name: 'Create a new wallet', value: 'create' },
    { name: 'List all wallets', value: 'list' },
    { name: 'Load wallet', value: 'load' },
    { name: 'Send transaction', value: 'send' },
  ],
}).then((answer) => {
  switch (answer) {
    case 'create':
      createWallet();
      break;
    case 'list':
      listWallets();
      break;
    case 'load':
      loadWallet();
      break;
    case 'send':
      console.log('Sending a transaction...');
      // Add logic to send a transaction
      break;
    default:
      console.log('Invalid option selected.');  
  }
}).catch((error) => {
  console.error('Error:', error);
});
