import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  isAddress,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { EvmChainConfig } from '../config/chain.types';
import { listAssets } from '../config/chains';
import { formatAmount } from '../shared/utils/amount';
import type { AssetBalance, ChainContext, NetworkAdapter, TransferRequest, TransferResult } from './network.types';

const CONFIRMATION_TIMEOUT_MS = 120_000;

/**
 * `transfer` with no declared outputs. Some tokens (notably USDT on Ethereum) don't return
 * the `bool` required by ERC-20, which makes viem's result decoding fail with the standard ABI.
 * Declaring no outputs works for both compliant and non-compliant tokens; success is verified
 * via the transaction receipt instead.
 */
const transferAbi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

function publicClientFor(chain: ChainContext<EvmChainConfig>): PublicClient {
  return createPublicClient({ chain: chain.config.viemChain, transport: http(chain.rpcUrl) });
}

async function maxFeePerGas(client: PublicClient): Promise<bigint> {
  const fees = await client.estimateFeesPerGas().catch(() => undefined);
  return fees?.maxFeePerGas ?? fees?.gasPrice ?? (await client.getGasPrice());
}

async function readTokenDecimals(client: PublicClient, address: Address): Promise<number> {
  return Number(await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }));
}

async function waitForConfirmation(client: PublicClient, hash: Hash) {
  console.log(`Transaction submitted: ${hash}`);

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, timeout: CONFIRMATION_TIMEOUT_MS, confirmations: 1 });
  } catch (error) {
    throw new Error(
      `Transaction submitted but not confirmed within ${CONFIRMATION_TIMEOUT_MS / 1000}s. Hash: ${hash}. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted. Hash: ${hash}; block: ${receipt.blockNumber}`);
  }

  return receipt;
}

export const evmAdapter: NetworkAdapter<EvmChainConfig> = {
  label: 'EVM',

  async generateWallet() {
    const privateKey = generatePrivateKey();
    return { address: privateKeyToAccount(privateKey).address, privateKey };
  },

  isValidAddress(address) {
    return isAddress(address);
  },

  async getBalances(chain, address) {
    if (!isAddress(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }

    const client = publicClientFor(chain);
    const assets = listAssets(chain.id);

    const settled = await Promise.allSettled(
      assets.map((asset) =>
        asset.kind === 'native'
          ? client.getBalance({ address })
          : client.readContract({
              address: asset.address as Address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            }),
      ),
    );

    return settled.map(
      (result, i): AssetBalance => ({
        asset: assets[i]!,
        balance:
          result.status === 'fulfilled'
            ? result.value
            : { error: String(result.reason?.shortMessage ?? result.reason?.message ?? result.reason) },
      }),
    );
  },

  async transfer(request: TransferRequest<EvmChainConfig>): Promise<TransferResult> {
    const { chain, asset, amount } = request;
    const { viemChain, nativeCurrency } = chain.config;

    if (!isAddress(request.to)) {
      throw new Error('Invalid EVM recipient address');
    }

    const to = request.to;
    const privateKey = (request.privateKey.startsWith('0x') ? request.privateKey : `0x${request.privateKey}`) as Hash;
    const account = privateKeyToAccount(privateKey);
    const client = publicClientFor(chain);
    const walletClient = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrl), account });

    const fmtNative = (value: bigint) => `${formatAmount(value, nativeCurrency.decimals)} ${nativeCurrency.symbol}`;

    let hash: Hash;

    if (asset.kind === 'native') {
      const [balance, gas, feePerGas] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.estimateGas({ account: account.address, to, value: amount }),
        maxFeePerGas(client),
      ]);

      const estimatedFee = gas * feePerGas;
      if (balance < amount + estimatedFee) {
        // Don't echo the amount (or amount + fee): amounts are kept off-screen.
        throw new Error(
          `Insufficient ${nativeCurrency.symbol} for amount plus estimated fee (${fmtNative(estimatedFee)}). ` +
            `Balance: ${fmtNative(balance)}`,
        );
      }

      hash = await walletClient.sendTransaction({ account, chain: viemChain, to, value: amount });
    } else {
      const tokenAddress = asset.address as Address;

      const [onChainDecimals, tokenBalance] = await Promise.all([
        readTokenDecimals(client, tokenAddress),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
      ]);

      if (onChainDecimals !== asset.decimals) {
        throw new Error(
          `${asset.symbol} on ${chain.config.name} has ${onChainDecimals} decimals on-chain but ` +
            `${asset.decimals} in config. Fix src/config/chains.ts before sending.`,
        );
      }

      if (tokenBalance < amount) {
        throw new Error(
          `Insufficient ${asset.symbol}. Balance: ${formatAmount(tokenBalance, asset.decimals)} ${asset.symbol}`,
        );
      }

      const call = { account, address: tokenAddress, abi: transferAbi, functionName: 'transfer', args: [to, amount] } as const;

      const { request: simulated } = await client.simulateContract(call);
      const [gas, feePerGas, nativeBalance] = await Promise.all([
        client.estimateContractGas(call),
        maxFeePerGas(client),
        client.getBalance({ address: account.address }),
      ]);

      const estimatedFee = gas * feePerGas;
      if (nativeBalance < estimatedFee) {
        throw new Error(
          `Insufficient ${nativeCurrency.symbol} for gas. Balance: ${fmtNative(nativeBalance)}; ` +
            `estimated fee: ${fmtNative(estimatedFee)}`,
        );
      }

      hash = await walletClient.writeContract(simulated);
    }

    const receipt = await waitForConfirmation(client, hash);

    return {
      chainId: chain.id,
      transactionHash: hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  },
};
