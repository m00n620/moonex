import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  isAddress,
  isAddressEqual,
  isHex,
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

/** `approve` with no declared outputs, for the same reason as `transferAbi`. */
const approveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

function accountFrom(privateKey: string) {
  return privateKeyToAccount((privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hash);
}

/** Parses a hex (`0x…`) or decimal quantity string; empty means zero. */
function parseQuantity(value: string | undefined): bigint {
  return value ? BigInt(value) : 0n;
}

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

  isSameAddress(a, b) {
    return isAddress(a) && isAddress(b) && isAddressEqual(a, b);
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
    const account = accountFrom(request.privateKey);
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

  async approve({ chain, privateKey, asset, spender, amount }) {
    if (!isAddress(spender)) {
      throw new Error(`Invalid EVM spender address: ${spender}`);
    }

    const account = accountFrom(privateKey);
    const client = publicClientFor(chain);
    const token = asset.address as Address;

    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, spender],
    });
    if (allowance >= amount) return false;

    const walletClient = createWalletClient({ chain: chain.config.viemChain, transport: http(chain.rpcUrl), account });
    const setAllowance = async (value: bigint) => {
      const { request } = await client.simulateContract({
        account,
        address: token,
        abi: approveAbi,
        functionName: 'approve',
        args: [spender, value],
      });
      await waitForConfirmation(client, await walletClient.writeContract(request));
    };

    // Some tokens (notably USDT on Ethereum) refuse to change a non-zero allowance to another non-zero value.
    if (allowance > 0n) {
      console.log(`Resetting existing ${asset.symbol} allowance to 0...`);
      await setAllowance(0n);
    }

    console.log(`Approving ${asset.symbol} for ${spender}...`);
    await setAllowance(amount);
    return true;
  },

  async estimateFees({ chain, owner, asset, amount, spender, transaction: tx }) {
    if (!isAddress(owner)) {
      throw new Error(`Invalid EVM address: ${owner}`);
    }

    const client = publicClientFor(chain);
    const [feePerGas, nativeBalance] = await Promise.all([maxFeePerGas(client), client.getBalance({ address: owner })]);

    let approvalTxs = 0;
    let approvalGas = 0n;
    if (asset.kind === 'token' && spender && isAddress(spender)) {
      const token = asset.address as Address;
      const allowance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, spender],
      });

      if (allowance < amount) {
        approvalTxs = allowance > 0n ? 2 : 1; // reset to 0 first, then set
        approvalGas = await client
          .estimateContractGas({ account: owner, address: token, abi: approveAbi, functionName: 'approve', args: [spender, amount] })
          .catch(() => 60_000n);
      }
    }

    // Same rule as sendPreparedTransaction: the larger of the router's gas limit and a fresh estimate.
    // A fresh estimate is only possible when no approval is pending (the call would revert without it).
    const value = parseQuantity(tx.value);
    let gas = parseQuantity(tx.gasLimit);
    if (approvalTxs === 0 && isAddress(tx.to) && isHex(tx.data)) {
      const estimated = await client.estimateGas({ account: owner, to: tx.to, data: tx.data, value }).catch(() => 0n);
      if (estimated > gas) gas = estimated;
    }
    if (gas === 0n) gas = 500_000n;

    return {
      approvalFee: approvalGas * BigInt(approvalTxs) * feePerGas,
      approvalTxs,
      transactionFee: gas * feePerGas,
      extraValue: asset.kind === 'native' ? (value > amount ? value - amount : 0n) : value,
      nativeBalance,
    };
  },

  async sendPreparedTransaction({ chain, privateKey, asset, amount, transaction: tx }) {
    const { viemChain, nativeCurrency } = chain.config;

    if (!isAddress(tx.to)) {
      throw new Error(`Prepared transaction has an invalid target address: ${tx.to}`);
    }
    if (!isHex(tx.data)) {
      throw new Error('Prepared transaction has invalid calldata');
    }
    if (tx.chainId !== undefined && tx.chainId !== viemChain.id) {
      throw new Error(`Prepared transaction is for chain ${tx.chainId}, not ${chain.config.name} (${viemChain.id})`);
    }

    const account = accountFrom(privateKey);
    if (tx.from && (!isAddress(tx.from) || !isAddressEqual(tx.from, account.address))) {
      throw new Error(`Prepared transaction is for sender ${tx.from}, not ${account.address}`);
    }

    const to = tx.to;
    const data = tx.data;
    const value = parseQuantity(tx.value);
    const client = publicClientFor(chain);
    const fmtNative = (v: bigint) => `${formatAmount(v, nativeCurrency.decimals)} ${nativeCurrency.symbol}`;

    if (asset.kind === 'native' && value < amount) {
      throw new Error('Prepared transaction sends less than the requested amount');
    }

    const nativeBalance = await client.getBalance({ address: account.address });
    if (asset.kind === 'native' && nativeBalance < value) {
      throw new Error(`Insufficient ${nativeCurrency.symbol}. Balance: ${fmtNative(nativeBalance)}`);
    }

    if (asset.kind === 'token') {
      const tokenBalance = await client.readContract({
        address: asset.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      if (tokenBalance < amount) {
        throw new Error(`Insufficient ${asset.symbol}. Balance: ${formatAmount(tokenBalance, asset.decimals)} ${asset.symbol}`);
      }
    }

    // Gas estimation doubles as a simulation: a call that would revert fails here, before anything is signed.
    const [estimatedGas, feePerGas] = await Promise.all([
      client.estimateGas({ account: account.address, to, data, value }),
      maxFeePerGas(client),
    ]);
    const providedGas = parseQuantity(tx.gasLimit);
    const gas = providedGas > estimatedGas ? providedGas : estimatedGas;

    const estimatedFee = gas * feePerGas;
    if (nativeBalance < value + estimatedFee) {
      // `value` may include the amount for native transfers, so only the fee and balance are shown.
      throw new Error(
        `Insufficient ${nativeCurrency.symbol} for value plus estimated fee (${fmtNative(estimatedFee)}). ` +
          `Balance: ${fmtNative(nativeBalance)}`,
      );
    }

    const walletClient = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrl), account });
    const hash = await walletClient.sendTransaction({ account, chain: viemChain, to, data, value, gas });
    const receipt = await waitForConfirmation(client, hash);

    return { chainId: chain.id, transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
  },
};
