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

type FeeParams = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint };

/**
 * Current fee values, plus the per-gas ceiling (`max`) used for balance checks. The params are passed to the
 * signed transaction so it uses exactly the fees the balance check assumed, and viem doesn't query them again.
 */
async function feesPerGas(client: PublicClient): Promise<{ params: FeeParams; max: bigint }> {
  const fees = await client.estimateFeesPerGas().catch(() => undefined);
  if (fees?.maxFeePerGas !== undefined && fees.maxPriorityFeePerGas !== undefined) {
    const { maxFeePerGas, maxPriorityFeePerGas } = fees;
    return { params: { maxFeePerGas, maxPriorityFeePerGas }, max: maxFeePerGas };
  }
  const gasPrice = fees?.gasPrice ?? (await client.getGasPrice());
  return { params: { gasPrice }, max: gasPrice };
}

type Account = ReturnType<typeof accountFrom>;

function approveCall(account: Address | Account, token: Address, spender: Address, value: bigint) {
  return { account, address: token, abi: approveAbi, functionName: 'approve', args: [spender, value] } as const;
}

/**
 * Whether the allowance must be reset to 0 before approving `amount`, and the approval's gas when it can be
 * estimated now. Only tokens that refuse to change a non-zero allowance (notably USDT on Ethereum) need the
 * reset, so the direct approval is simulated first instead of always paying for an extra transaction.
 */
async function planApproval(
  client: PublicClient,
  owner: Address | Account,
  token: Address,
  spender: Address,
  allowance: bigint,
  amount: bigint,
): Promise<{ resetFirst: boolean; gas?: bigint }> {
  try {
    return { resetFirst: false, gas: await client.estimateContractGas(approveCall(owner, token, spender, amount)) };
  } catch (error) {
    if (allowance === 0n) throw error;
    return { resetFirst: true };
  }
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
      const [balance, gas, fees] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.estimateGas({ account: account.address, to, value: amount }),
        feesPerGas(client),
      ]);

      const estimatedFee = gas * fees.max;
      if (balance < amount + estimatedFee) {
        // Don't echo the amount (or amount + fee): amounts are kept off-screen.
        throw new Error(
          `Insufficient ${nativeCurrency.symbol} for amount plus estimated fee (${fmtNative(estimatedFee)}). ` +
            `Balance: ${fmtNative(balance)}`,
        );
      }

      hash = await walletClient.sendTransaction({ account, chain: viemChain, to, value: amount, gas, ...fees.params });
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

      // Gas estimation doubles as the simulation: a transfer that would revert fails here, before anything is signed.
      const [gas, fees, nativeBalance] = await Promise.all([
        client.estimateContractGas(call),
        feesPerGas(client),
        client.getBalance({ address: account.address }),
      ]);

      const estimatedFee = gas * fees.max;
      if (nativeBalance < estimatedFee) {
        throw new Error(
          `Insufficient ${nativeCurrency.symbol} for gas. Balance: ${fmtNative(nativeBalance)}; ` +
            `estimated fee: ${fmtNative(estimatedFee)}`,
        );
      }

      hash = await walletClient.writeContract({ ...call, chain: viemChain, gas, ...fees.params });
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

    const { viemChain } = chain.config;
    const walletClient = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrl), account });
    const setAllowance = async (value: bigint, knownGas?: bigint) => {
      const call = approveCall(account, token, spender, value);
      const [gas, fees] = await Promise.all([knownGas ?? client.estimateContractGas(call), feesPerGas(client)]);
      await waitForConfirmation(client, await walletClient.writeContract({ ...call, chain: viemChain, gas, ...fees.params }));
    };

    const plan = await planApproval(client, account, token, spender, allowance, amount);
    if (plan.resetFirst) {
      console.log(`Resetting existing ${asset.symbol} allowance to 0...`);
      await setAllowance(0n);
    }

    console.log(`Approving ${asset.symbol} for ${spender}...`);
    await setAllowance(amount, plan.gas);
    return true;
  },

  async estimateFees({ chain, owner, asset, amount, spender, transaction: tx }) {
    if (!isAddress(owner)) {
      throw new Error(`Invalid EVM address: ${owner}`);
    }

    const client = publicClientFor(chain);
    const [fees, nativeBalance] = await Promise.all([feesPerGas(client), client.getBalance({ address: owner })]);
    const feePerGas = fees.max;

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
        // Same rule as approve(): reset to 0 first only when the token rejects a direct change.
        const plan = await planApproval(client, owner, token, spender, allowance, amount).catch(
          (): { resetFirst: boolean; gas?: bigint } => ({ resetFirst: false }),
        );
        approvalTxs = plan.resetFirst ? 2 : 1;
        approvalGas =
          plan.gas ?? (await client.estimateContractGas(approveCall(owner, token, spender, 0n)).catch(() => 60_000n));
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
    const [estimatedGas, fees] = await Promise.all([
      client.estimateGas({ account: account.address, to, data, value }),
      feesPerGas(client),
    ]);
    const providedGas = parseQuantity(tx.gasLimit);
    const gas = providedGas > estimatedGas ? providedGas : estimatedGas;

    const estimatedFee = gas * fees.max;
    if (nativeBalance < value + estimatedFee) {
      // `value` may include the amount for native transfers, so only the fee and balance are shown.
      throw new Error(
        `Insufficient ${nativeCurrency.symbol} for value plus estimated fee (${fmtNative(estimatedFee)}). ` +
          `Balance: ${fmtNative(nativeBalance)}`,
      );
    }

    const walletClient = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrl), account });
    const hash = await walletClient.sendTransaction({ account, chain: viemChain, to, data, value, gas, ...fees.params });
    const receipt = await waitForConfirmation(client, hash);

    return { chainId: chain.id, transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
  },
};
