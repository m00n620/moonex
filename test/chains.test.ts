import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS } from '../src/config/chain.types';
import { chains, findAsset, getRpcUrl, listAssets, listChains, type ChainId } from '../src/config/chains';
import { getAdapter } from '../src/networks';

const chainIds = Object.keys(chains) as ChainId[];

for (const id of chainIds) {
  const chain = chains[id];

  test(`chain "${id}" is well-formed`, () => {
    assert.match(id, /^[a-z][a-z0-9_]*$/, 'chain id must be lowercase (it is used for <ID>_RPC_URL)');
    assert.ok(NETWORKS.includes(chain.network), `unknown network ${chain.network}`);
    assert.ok(chain.name, 'name is required');
    assert.ok(getRpcUrl(id).startsWith('http'), 'RPC URL must be http(s)');
    assert.ok(chain.txUrl('0xabc').startsWith('https://'), 'explorer URL must be https');
  });

  test(`chain "${id}" tokens are valid`, () => {
    const adapter = getAdapter(chain.network);
    const symbols = listAssets(id).map((asset) => asset.symbol.toUpperCase());

    assert.equal(new Set(symbols).size, symbols.length, `duplicate asset symbols: ${symbols.join(', ')}`);

    for (const token of chain.tokens) {
      assert.ok(adapter.isValidAddress(token.address), `${token.symbol}: invalid address ${token.address}`);
      assert.ok(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36, `${token.symbol}: bad decimals`);
    }

    const addresses = chain.tokens.map((token) => token.address.toLowerCase());
    assert.equal(new Set(addresses).size, addresses.length, 'duplicate token addresses');
  });
}

test('every network has at least one chain', () => {
  for (const network of NETWORKS) {
    assert.ok(listChains(network).length > 0, `no chains for ${network}`);
  }
});

test('native coin is listed first and asset lookup is case-insensitive', () => {
  assert.equal(listAssets('bsc')[0]?.symbol, 'BNB');
  assert.equal(listAssets('tron')[0]?.kind, 'native');
  assert.equal(findAsset('ethereum', 'usdt')?.kind, 'token');
  assert.equal(findAsset('base', 'USDT'), undefined);
});

test('RPC URL can be overridden per chain via env', () => {
  process.env.BASE_RPC_URL = 'https://example.invalid/rpc';
  try {
    assert.equal(getRpcUrl('base'), 'https://example.invalid/rpc');
  } finally {
    delete process.env.BASE_RPC_URL;
  }
});
