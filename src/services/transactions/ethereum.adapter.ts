import {
  isAddress,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  erc20Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TransferRequest, TransferResult } from './transaction.types';
import { networkConfig } from '../../config/network';

export async function sendEthereum(request: TransferRequest): Promise<TransferResult> {
  const network = networkConfig[request.network];

  if (!network) {
    throw new Error('Invalid EVM-compatible network');
  }

  if (!isAddress(request.to)) {
    throw new Error('Invalid Ethereum recipient address');
  }

  if (!network.rpcUrl) {
    throw new Error(`${request.network} RPC URL is not configured`);
  }

  const account = privateKeyToAccount(request.privateKey as `0x${string}`);
  const to = request.to as `0x${string}`;

  const publicClient = createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
    account,
  });

  if (request.assetType === 'native') {
    const value = parseEther(request.amount);
    const [balance, gas, fees] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.estimateGas({
        account: account.address,
        to,
        value,
      }),
      publicClient.estimateFeesPerGas(),
    ]);

    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;

    if (maxFeePerGas == null) {
      throw new Error('Unable to estimate transaction fees');
    }

    const estimatedFee = gas * maxFeePerGas;

    if (balance < value + estimatedFee) {
      throw new Error(
        `Insufficient ETH. Balance: ${formatEther(balance)} ETH; ` +
          `required amount plus estimated fee: ${formatEther(value + estimatedFee)} ETH`,
      );
    }

    const hash = await walletClient.sendTransaction({
      account,
      to,
      value,
      chain: network.chain,
    });

    return {
      network: request.network,
      transactionHash: hash,
    };
  }

  if (!request.tokenAddress || !isAddress(request.tokenAddress)) {
    throw new Error('A valid ERC-20 contract address is required');
  }

  const tokenAddress = request.tokenAddress as `0x${string}`;

  const [decimals, tokenBalance] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);

  const amount = parseUnits(request.amount, Number(decimals));

  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero');
  }

  if (tokenBalance < amount) {
    throw new Error('Insufficient ERC-20 token balance');
  }

  // Simulate the transfer before submitting it.
  const { request: simulatedRequest } = await publicClient.simulateContract({
    account,
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  });

  const [gas, fees, nativeBalance] = await Promise.all([
    publicClient.estimateContractGas({
      account,
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    }),
    publicClient.estimateFeesPerGas(),
    publicClient.getBalance({ address: account.address }),
  ]);

  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;

  if (maxFeePerGas == null) {
    throw new Error('Unable to estimate transaction fees');
  }

  const estimatedFee = gas * maxFeePerGas;

  if (nativeBalance < estimatedFee) {
    throw new Error(`Insufficient ETH for gas. Estimated fee: ${formatEther(estimatedFee)} ETH`);
  }

  const hash = await walletClient.writeContract(simulatedRequest);

  return {
    network: request.network,
    transactionHash: hash,
  };
}
