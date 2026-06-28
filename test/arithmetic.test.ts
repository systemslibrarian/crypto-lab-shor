import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extGcd,
  gcd,
  modPow,
  isqrt,
  isPrime,
  checkPerfectPower,
  classicalOrderFind,
  continuedFractionConvergents,
} from '../src/arithmetic.ts';

test('gcd', () => {
  assert.equal(gcd(0n, 5n), 5n);
  assert.equal(gcd(12n, 18n), 6n);
  assert.equal(gcd(17n, 5n), 1n);
  assert.equal(gcd(-12n, 18n), 6n);
});

test('extGcd satisfies Bézout identity', () => {
  for (const [a, b] of [[240n, 46n], [17n, 5n], [99n, 78n]] as Array<[bigint, bigint]>) {
    const { gcd: g, x, y } = extGcd(a, b);
    assert.equal(a * x + b * y, g);
    assert.equal(g, gcd(a, b));
  }
});

test('modPow', () => {
  assert.equal(modPow(2n, 10n, 1000n), 24n);
  assert.equal(modPow(7n, 0n, 13n), 1n);
  assert.equal(modPow(4n, 13n, 497n), 445n);
  assert.equal(modPow(123n, 456n, 1n), 0n);
});

test('isqrt (floor square root)', () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(15n), 3n);
  assert.equal(isqrt(16n), 4n);
  assert.equal(isqrt(9408n), 96n);
  assert.equal(isqrt(9409n), 97n); // 97^2 exactly
});

test('isPrime', () => {
  assert.equal(isPrime(0n), false);
  assert.equal(isPrime(1n), false);
  assert.equal(isPrime(2n), true);
  assert.equal(isPrime(3n), true);
  assert.equal(isPrime(15n), false);
  assert.equal(isPrime(97n), true);
  assert.equal(isPrime(9973n), true); // largest prime < 10000
  assert.equal(isPrime(9991n), false); // 97 * 103
});

test('checkPerfectPower', () => {
  assert.deepEqual(checkPerfectPower(9n), { isPerfectPower: true, base: 3n, exp: 2n });
  assert.deepEqual(checkPerfectPower(8n), { isPerfectPower: true, base: 2n, exp: 3n });
  assert.deepEqual(checkPerfectPower(9409n), { isPerfectPower: true, base: 97n, exp: 2n });
  assert.equal(checkPerfectPower(15n).isPerfectPower, false);
  assert.equal(checkPerfectPower(91n).isPerfectPower, false);
});

test('classicalOrderFind finds the multiplicative order', () => {
  // ord_15(2): 2,4,8,1 → r = 4
  assert.equal(classicalOrderFind(2n, 15n, 1000), 4n);
  // ord_7(2): 2,4,1 → r = 3
  assert.equal(classicalOrderFind(2n, 7n, 1000), 3n);
  // a^r ≡ 1 always holds at the returned r
  for (const [a, n] of [[2n, 21n], [5n, 91n], [8n, 9991n]] as Array<[bigint, bigint]>) {
    const r = classicalOrderFind(a, n, 10000);
    assert.notEqual(r, null);
    assert.equal(modPow(a, r!, n), 1n);
  }
});

test('classicalOrderFind returns null past the iteration limit', () => {
  assert.equal(classicalOrderFind(2n, 9991n, 3), null);
});

test('continuedFractionConvergents recovers period from a phase k·Q/r', () => {
  // Q = 256, r = 4, k = 1 → m = 64 → 64/256 = 1/4, denominator 4 = r
  const conv = continuedFractionConvergents(64n, 256n, 15n);
  assert.ok(conv.some(c => c.den === 4n));
  // convergents must stay within maxDen
  for (const c of conv) assert.ok(c.den <= 15n);
});
