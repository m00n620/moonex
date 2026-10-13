import { mainnet, base } from "viem/chains";

export const networkConfig = {
  ethereum: {
    chain: mainnet,
    rpcUrl: process.env.ETHEREUM_RPC_URL,
  },
  base: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL,
  },
};
