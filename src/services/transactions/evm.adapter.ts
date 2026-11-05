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
import type { EvmTransferRequest, TransferResult } from './transaction.types';
import { networkConfig } from '../../config/network';
import usdtAbi from '../../shared/abis/usdt.json';

const TRANSACTION_TIMEOUT = 120_000; // 2 minutes

export async function sendEvm(request: EvmTransferRequest): Promise<TransferResult> {
  const network = networkConfig[request.chain];

  if (!network?.chain) {
    throw new Error('Invalid EVM-compatible network');
  }

  if (!isAddress(request.to)) {
    throw new Error('Invalid Ethereum recipient address');
  }

  if (!network.rpcUrl) {
    throw new Error(`${request.chain} RPC URL is not configured`);
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

  // Wait for transaction confirmation and validate receipt.
  const waitForConfirmation = async (hash: `0x${string}`) => {
    console.log(`[EVM] Transaction submitted: ${hash}`);

    let receipt;

    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: TRANSACTION_TIMEOUT,
        confirmations: 1,
      });
    } catch (error) {
      throw new Error(
        `Transaction submitted but not confirmed within ${TRANSACTION_TIMEOUT / 1000} seconds. Hash: ${hash}. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (receipt.status !== 'success') {
      throw new Error(`Transaction execution failed. Hash: ${hash}; ` + `Block: ${receipt.blockNumber}`);
    }

    console.log('[EVM] Transaction confirmed:', {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    });

    return receipt;
  };

  // Native ETH transfer.
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

    const receipt = await waitForConfirmation(hash);

    return {
      chain: request.chain,
      transactionHash: hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      status: receipt.status,
    };
  }

  // ERC-20 transfer.
  if (!request.tokenAddress || !isAddress(request.tokenAddress)) {
    throw new Error('A valid ERC-20 contract address is required');
  }

  const tokenAddress = request.tokenAddress as `0x${string}`;
  const tokenSymbol = request.tokenSymbol;

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

  const abi = tokenSymbol === 'USDT' ? usdtAbi : erc20Abi;

  const { request: simulatedRequest } = await publicClient.simulateContract({
    account,
    address: tokenAddress,
    abi,
    functionName: 'transfer',
    args: [to, amount],
  });

  const [gas, fees, nativeBalance] = await Promise.all([
    publicClient.estimateContractGas({
      account,
      address: tokenAddress,
      abi,
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
  const receipt = await waitForConfirmation(hash);

  return {
    chain: request.chain,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status,
  };
}
