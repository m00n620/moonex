/** Parses a decimal string (e.g. "1.25") into base units. Throws on malformed input or excess precision. */
export function parseAmount(amount: string, decimals: number): bigint {
  const value = amount.trim();

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }

  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) {
    throw new Error('Amount must be a positive decimal number');
  }

  const [whole = '', fraction = ''] = value.split('.');

  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }

  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Formats base units as a decimal string without trailing zeros. */
export function formatAmount(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
