import dotenv from 'dotenv';

dotenv.config();

export const env = {
  mongoUri: process.env.MONGODB_URI || '',
  rpcUrls: {
    ethereum: process.env.ETHEREUM_RPC_URL || '',
    base: process.env.BASE_RPC_URL || '',
    tron: process.env.TRON_RPC_URL || '',
  },
};
