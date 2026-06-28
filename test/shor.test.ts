import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShor } from '../src/shor.ts';
import { modPow } from '../src/arithmetic.ts';

const noop = () => {};

test('factors small semiprimes correctly', async () => {
  const cases: Array<[bigint, [bigint, bigint]]> = [
    [15n, [3n, 5n]],
    [21n, [3n, 7n]],
    [35n, [5n, 7n]],
    [77n, [7n, 11n]],
    [143n, [11n, 13n]],
    [221n, [13n, 17n]],
  ];
  for (const [N, expected] of cases) {
    const res = await runShor(N, noop);
    assert.notEqual(res.factors, null, `expected factors for N=${N}`);
    const [p, q] = res.factors!;
    assert.equal(p * q, N);
    const got = [p, q].sort((a, b) => Number(a - b));
    assert.deepEqual(got, expected);
  }
});

test('handles even N classically without the quantum step', async () => {
  const res = await runShor(12n, noop);
  assert.deepEqual(res.factors, [2n, 6n]);
  assert.equal(res.attempts, 0);
  assert.equal(res.steps.at(-1)?.label, 'Trivial factor');
});

test('detects perfect powers', async () => {
  const res = await runShor(9409n, noop); // 97^2
  assert.notEqual(res.factors, null);
  assert.equal(res.factors![0] * res.factors![1], 9409n);
  assert.ok(res.steps.some(s => s.label === 'Perfect power'));
});

test('reports prime input instead of looping', async () => {
  const res = await runShor(97n, noop);
  assert.equal(res.factors, null);
  assert.equal(res.attempts, 0);
  assert.match(res.note ?? '', /prime/i);
  assert.ok(res.steps.some(s => s.label === 'Prime input'));
});

test('rejects N below 4', async () => {
  const res = await runShor(3n, noop);
  assert.equal(res.factors, null);
  assert.match(res.note ?? '', /too small/i);
});

test('large N within range is reliable (stress, 25 runs)', async () => {
  // The hardest in-range cases historically failed often; require 100% now.
  for (const N of [8051n, 9991n, 3599n]) {
    for (let i = 0; i < 25; i++) {
      const res = await runShor(N, noop);
      assert.notEqual(res.factors, null, `N=${N} failed on run ${i}`);
      assert.equal(res.factors![0] * res.factors![1], N);
    }
  }
});

test('every continued-fraction step reports an r with a^r ≡ 1 mod N', async () => {
  // Across many runs (some short-circuit via Lucky GCD and emit no CF step),
  // whenever a Continued fractions step IS emitted, its chosen r must verify
  // against the base a from that same attempt.
  for (let i = 0; i < 40; i++) {
    const res = await runShor(247n, noop); // 13 * 19
    let a: bigint | null = null;
    for (const s of res.steps) {
      if (s.label === 'Random base' || s.label === 'Lucky GCD') {
        a = (s.data as { a?: bigint }).a ?? a;
      }
      if (s.label === 'Continued fractions') {
        const { chosenR } = s.data as { chosenR: bigint };
        assert.notEqual(a, null, 'a base must precede a Continued fractions step');
        assert.equal(modPow(a!, chosenR, 247n), 1n, `a^r ≢ 1 mod N (a=${a}, r=${chosenR})`);
      }
    }
  }
});
