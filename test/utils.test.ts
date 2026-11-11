import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, parseAmount } from '../src/shared/utils/amount';
import { decryptPrivateKey, encryptPrivateKey } from '../src/shared/utils/encryption';

test('parseAmount converts decimals to base units', () => {
  assert.equal(parseAmount('1', 6), 1_000_000n);
  assert.equal(parseAmount('1.5', 18), 1_500_000_000_000_000_000n);
  assert.equal(parseAmount('0.000001', 6), 1n);
  assert.equal(parseAmount('.5', 2), 50n);
  assert.equal(parseAmount(' 2. ', 2), 200n);
  assert.equal(parseAmount('0', 6), 0n);
});

test('parseAmount rejects malformed input and excess precision', () => {
  for (const bad of ['', '-1', '1e3', 'abc', '1.2.3', '1,5', '.']) {
    assert.throws(() => parseAmount(bad, 6), undefined, `should reject "${bad}"`);
  }
  assert.throws(() => parseAmount('0.0000001', 6), /at most 6/);
});

test('formatAmount round-trips with parseAmount', () => {
  assert.equal(formatAmount(1_500_000n, 6), '1.5');
  assert.equal(formatAmount(0n, 18), '0');
  assert.equal(formatAmount(1n, 18), '0.000000000000000001');
  for (const value of ['123.456', '0.1', '42']) {
    assert.equal(formatAmount(parseAmount(value, 18), 18), value);
  }
});

test('encryption round-trips and rejects a wrong password', () => {
  const secret = '0x' + 'ab'.repeat(32);
  const payload = encryptPrivateKey(secret, 'correct horse');

  assert.equal(decryptPrivateKey(payload, 'correct horse'), secret);
  assert.throws(() => decryptPrivateKey(payload, 'wrong'));
  assert.throws(() => encryptPrivateKey(secret, '   '));
});
