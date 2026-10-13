export async function sendEthereum(request: TransferRequest): Promise<TransferResult> {
  if (request.network !== 'ethereum-sepolia' && request.network !== 'ethereum-mainnet') {
    throw new Error('Invalid Ethereum network');
  }

  if (!isAddress(request.to)) {
    throw new Error('Invalid Ethereum recipient address');
  }

  const config = NETWORKS[request.network];
  const rpcUrl = process.env[config.env];

  if (!rpcUrl) {
    throw new Error(`${config.env} is not configured`);
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  if (network.chainId !== config.chainId) {
    throw new Error('RPC endpoint chain ID does not match configuration');
  }

  const signer = new Wallet(request.privateKey, provider);

  if (request.assetType === 'native') {
    const value = parseUnits(request.amount, 18);
    const balance = await provider.getBalance(signer.address);
    const fee = await provider.getFeeData();

    if (fee.maxFeePerGas == null && fee.gasPrice == null) {
      throw new Error('Unable to estimate transaction fees');
    }

    const gasPrice = fee.maxFeePerGas ?? fee.gasPrice!;
    const gasLimit = 21000n;

    if (balance < value + gasLimit * gasPrice) {
      throw new Error('Insufficient ETH for amount and estimated fee');
    }

    const tx = await signer.sendTransaction({
      to: request.to,
      value,
    });

    return {
      network: request.network,
      transactionHash: tx.hash,
    };
  }

  if (!request.tokenAddress || !isAddress(request.tokenAddress)) {
    throw new Error('A valid ERC-20 contract address is required');
  }

  const token = new Contract(request.tokenAddress, ERC20_ABI, signer);

  const decimals = Number(await token.decimals());
  const amount = parseUnits(request.amount, decimals);
  const balance = await token.balanceOf(signer.address);

  if (balance < amount) {
    throw new Error('Insufficient token balance');
  }

  const tx = await token.transfer(request.to, amount);

  return {
    network: request.network,
    transactionHash: tx.hash,
  };
}
