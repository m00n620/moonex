import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chains, findAsset } from '../src/config/chains';
import { describeGas, describeQuote, quoteBridge, type BridgeGasEstimate, type BridgeRequest } from '../src/services/bridge/bridge.service';

const ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const SENDER = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0';
const RECIPIENT_TRON = 'TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi';
const OTHER_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const request: BridgeRequest = {
  fromChainId: 'base',
  fromAsset: findAsset('base', 'USDC')!,
  toChainId: 'tron',
  toAsset: findAsset('tron', 'USDT')!,
  amount: 50_000_000n,
  fromAddress: SENDER,
  toAddress: RECIPIENT_TRON,
  slippage: 0.005,
};

function validQuote() {
  return {
    id: 'q1',
    tool: 'someBridge',
    action: {
      fromChainId: 8453,
      toChainId: 728126428,
      fromAmount: '50000000',
      fromAddress: SENDER.toLowerCase(),
      toAddress: RECIPIENT_TRON,
      fromToken: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, chainId: 8453 },
      toToken: { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', symbol: 'USDT', decimals: 6, chainId: 728126428 },
    },
    estimate: { approvalAddress: ROUTER, toAmount: '49800000', toAmountMin: '49550000', fromAmountUSD: '50', toAmountUSD: '49.8' },
    transactionRequest: { to: ROUTER, data: '0xabcdef', value: '0x0', from: SENDER, chainId: 8453 },
  };
}

const originalFetch = globalThis.fetch;
let lastUrl: URL | undefined;

function mockQuote(body: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    lastUrl = new URL(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  lastUrl = undefined;
});

test('chains expose numeric chain ids used for routing', () => {
  assert.equal(chains.ethereum.chainId, 1);
  assert.equal(chains.base.chainId, 8453);
  assert.equal(chains.bsc.chainId, 56);
  assert.equal(chains.tron.chainId, 728126428);
});

test('a matching quote is accepted and the request is sent with numeric chain ids and token addresses', async () => {
  mockQuote(validQuote());
  const quote = await quoteBridge(request);

  assert.equal(quote.spender, ROUTER);
  assert.equal(quote.transaction.to, ROUTER);
  assert.equal(lastUrl?.searchParams.get('fromChain'), '8453');
  assert.equal(lastUrl?.searchParams.get('toChain'), '728126428');
  assert.equal(lastUrl?.searchParams.get('toToken'), OTHER_TRON);
  assert.equal(lastUrl?.searchParams.get('toAddress'), RECIPIENT_TRON);
  assert.equal(lastUrl?.searchParams.get('fromAmount'), '50000000');
});

const tamperings: [string, (q: ReturnType<typeof validQuote>) => void, RegExp][] = [
  ['recipient', (q) => (q.action.toAddress = OTHER_TRON), /recipient/],
  ['amount', (q) => (q.action.fromAmount = '60000000'), /amount/],
  ['destination chain', (q) => (q.action.toChainId = 56), /destination chain/],
  ['destination token', (q) => (q.action.toToken.address = RECIPIENT_TRON), /destination asset/],
  ['approval target', (q) => (q.estimate.approvalAddress = SENDER), /approval address/],
  ['transaction sender', (q) => (q.transactionRequest.from = ROUTER), /transaction sender/],
  ['minimum received', (q) => (q.estimate.toAmountMin = '0'), /minimum received/],
];

for (const [name, tamper, error] of tamperings) {
  test(`a quote with a different ${name} is rejected`, async () => {
    const quote = validQuote();
    tamper(quote);
    mockQuote(quote);
    await assert.rejects(quoteBridge(request), error);
  });
}

test('same-chain bridging and invalid recipients are rejected before calling the API', async () => {
  mockQuote(validQuote());
  await assert.rejects(quoteBridge({ ...request, toChainId: 'base', toAsset: request.fromAsset }), /must differ/);
  await assert.rejects(quoteBridge({ ...request, toAddress: SENDER }), /Invalid recipient/);
  assert.equal(lastUrl, undefined);
});

test('API errors surface the provider message', async () => {
  mockQuote({ message: 'No available quotes for the requested transfer', code: 1002 }, 404);
  await assert.rejects(quoteBridge(request), /No available quotes/);
});

test('quote summary itemises bridge fees, unexplained costs and total cost', async () => {
  const quote = validQuote();
  Object.assign(quote.estimate, {
    fromAmountUSD: '20',
    toAmountUSD: '18.30',
    feeCosts: [
      { name: 'LIFI Fixed Fee', percentage: '0.0025', amountUSD: '0.05', included: true, amount: '50000', token: quote.action.fromToken },
      { name: 'Protocol Fee', percentage: '0.0005', amountUSD: '0.01', included: true, amount: '10000', token: quote.action.fromToken },
    ],
    gasCosts: [{ amountUSD: '0.10', amount: '1', token: quote.action.fromToken }],
  });
  mockQuote(quote);
  const lines = describeQuote(await quoteBridge(request)).join('\n');

  assert.match(lines, /Bridge fees: +~\$0\.06 \(0\.30%\)/);
  assert.match(lines, /LIFI Fixed Fee: \$0\.05 \(0\.25%\)/);
  assert.match(lines, /Other costs: +~\$1\.64 \(8\.20%\)/);
});

function gasEstimate(overrides: Partial<BridgeGasEstimate['source']> = {}, recipientBalance?: bigint): BridgeGasEstimate {
  const fee = 10n ** 13n; // 0.00001 ETH
  return {
    source: {
      chainName: 'Base',
      network: 'evm',
      native: { symbol: 'ETH', decimals: 18 },
      priceUsd: 3000,
      approvalFee: fee,
      approvalTxs: 1,
      transactionFee: 3n * fee,
      expectedTransactionFee: fee,
      extraValue: 0n,
      totalFee: 4n * fee,
      nativeBalance: 10n ** 15n,
      assetBalance: 10n ** 9n,
      enoughGas: true,
      enoughAsset: true,
      ...overrides,
    },
    destination: { chainName: 'TRON', native: { symbol: 'TRX', decimals: 6 }, recipientBalance },
  };
}

test('gas summary shows native amounts for both chains and the total cost', async () => {
  const quote = validQuote();
  Object.assign(quote.estimate, { fromAmountUSD: '20', toAmountUSD: '19.80' });
  mockQuote(quote);
  const bridge = await quoteBridge(request);
  const lines = describeGas(bridge, gasEstimate({}, 0n)).join('\n');

  assert.match(lines, /Gas on Base \(source, paid in ETH/);
  assert.match(lines, /Approval: +0\.00001 ETH \(~\$0\.03\)/);
  assert.match(lines, /Bridge tx: +up to 0\.00003 ETH \(~\$0\.09\)/);
  assert.match(lines, /usually ~0\.00001 ETH/);
  assert.match(lines, /Total needed: +0\.00004 ETH \(~\$0\.12\)/);
  assert.match(lines, /Wallet has: +0\.001 ETH ✓/);
  assert.match(lines, /Gas on TRON \(destination\)/);
  assert.match(lines, /To receive: +nothing/);
  assert.match(lines, /Recipient has: 0 TRX, they'll need TRX/);
  // $0.20 value lost + (approval + expected tx) 0.00002 ETH × $3000 = $0.06
  assert.match(lines, /Total cost: +~\$0\.26/);
});

test('gas summary flags a wallet that is short on gas', async () => {
  mockQuote(validQuote());
  const bridge = await quoteBridge(request);
  const lines = describeGas(bridge, gasEstimate({ nativeBalance: 10n ** 13n, enoughGas: false, approvalTxs: 2 })).join('\n');

  assert.match(lines, /2 transactions \(reset to 0, then approve\)/);
  assert.match(lines, /✗ short by 0\.00003 ETH/);
});
