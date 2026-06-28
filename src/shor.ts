/**
 * Shor's Algorithm Engine
 *
 * Implements the complete four-step algorithm with full step-by-step tracing.
 *
 * Order finding (the only step a real quantum computer performs) is simulated
 * classically: for the demo's range (N < 10,000) the true period r is found by
 * direct search, then the quantum measurement is modelled by sampling from the
 * ideal QFT probability distribution, which peaks at m = k·Q/r. Continued
 * fractions then recover r from the sampled m — exactly the post-processing a
 * real Shor run performs. Every quantum step is clearly labelled as simulated.
 */

import {
  gcd,
  modPow,
  isPrime,
  checkPerfectPower,
  classicalOrderFind,
  continuedFractionConvergents,
} from './arithmetic.ts';
import { computeQFTDistribution, sampleQFTMeasurement } from './qft.ts';

export interface ShorStep {
  label: string;
  description: string;
  data: unknown;
  success: boolean;
  retryReason?: string;
}

export interface ShorResult {
  N: bigint;
  factors: [bigint, bigint] | null;
  steps: ShorStep[];
  attempts: number;
  totalTime: number; // ms
  /** Set when there is no factorisation to find (e.g. N is prime or too small). */
  note?: string;
}

/**
 * Generate a cryptographically random BigInt in [min, max] inclusive.
 */
async function cryptoRandomBigInt(min: bigint, max: bigint): Promise<bigint> {
  const range = max - min + 1n;
  const bits = range.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);

  // Rejection sampling to avoid modulo bias
  for (let attempts = 0; attempts < 1000; attempts++) {
    crypto.getRandomValues(buf);
    let val = 0n;
    for (const byte of buf) val = (val << 8n) | BigInt(byte);
    // Mask to required bit length
    const mask = (1n << BigInt(bits)) - 1n;
    val = val & mask;
    if (val < range) return val + min;
  }
  // Fallback: return midpoint (shouldn't happen)
  return min + range / 2n;
}

/**
 * Ceiling of log2(n) for BigInt.
 */
function ceilLog2(n: bigint): number {
  let bits = 0;
  let x = n - 1n;
  while (x > 0n) { x >>= 1n; bits++; }
  return bits === 0 ? 1 : bits;
}

/**
 * Run Shor's algorithm on N.
 * Returns full step-by-step trace for UI visualization.
 * maxAttempts: retry limit (default 20).
 */
export async function runShor(
  N: bigint,
  onStep: (step: ShorStep) => void,
  maxAttempts = 20
): Promise<ShorResult> {
  const startTime = performance.now();
  const steps: ShorStep[] = [];
  let attempts = 0;
  let factors: [bigint, bigint] | null = null;

  function emit(step: ShorStep): void {
    steps.push(step);
    onStep(step);
  }

  // ── Step 1: Classical pre-checks ─────────────────────────────────────────

  if (N < 4n) {
    emit({ label: 'Pre-check', description: `N = ${N} is too small. Shor's algorithm requires N ≥ 4.`, data: null, success: false });
    return { N, factors: null, steps, attempts: 0, totalTime: performance.now() - startTime, note: `N = ${N} is too small to factor (need N ≥ 4).` };
  }

  if (N % 2n === 0n) {
    const f2: [bigint, bigint] = [2n, N / 2n];
    emit({ label: 'Trivial factor', description: `N = ${N} is even. Factor: 2 × ${N / 2n}`, data: { factors: f2 }, success: true });
    return { N, factors: f2, steps, attempts: 0, totalTime: performance.now() - startTime };
  }

  const pp = checkPerfectPower(N);
  if (pp.isPerfectPower && pp.base !== undefined) {
    const fb: [bigint, bigint] = [pp.base, N / pp.base];
    emit({
      label: 'Perfect power',
      description: `N = ${N} = ${pp.base}^${pp.exp}. This is a perfect power — a degenerate case that bypasses the quantum step.`,
      data: { base: pp.base, exp: pp.exp, factors: fb },
      success: true
    });
    return { N, factors: fb, steps, attempts: 0, totalTime: performance.now() - startTime };
  }

  if (isPrime(N)) {
    emit({
      label: 'Prime input',
      description: `N = ${N} is prime. Shor's algorithm factors composite numbers — a prime has no non-trivial factors to find. Try a composite N (e.g. a product of two primes).`,
      data: { prime: true },
      success: false
    });
    return { N, factors: null, steps, attempts: 0, totalTime: performance.now() - startTime, note: `N = ${N} is prime — there is nothing to factor.` };
  }

  emit({
    label: 'Pre-check',
    description: `N = ${N} is odd, composite, not a perfect power, and ≥ 4. Proceeding to quantum order finding.`,
    data: { N },
    success: true
  });

  // ── Steps 2–4: Loop with retries ─────────────────────────────────────────

  const L = ceilLog2(N);
  const Q = 1 << (2 * L); // Q = 2^(2L) — as a regular number (safe for L <= 14)
  const Qn = BigInt(Q);

  // Qubit count for display: 3 * ceil(log2(N)) + 3
  const qubitCount = 3 * L + 3;

  emit({
    label: 'Resource estimate',
    description: `Register size Q = 2^(2·${L}) = ${Q}. Required qubits: 3·⌈log₂(${N})⌉ + 3 = ${qubitCount} (classically simulated).`,
    data: { L, Q, qubitCount },
    success: true
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;

    // Pick random a in [2, N-1]
    const a = await cryptoRandomBigInt(2n, N - 1n);
    const g = gcd(a, N);

    if (g > 1n) {
      // Lucky! Found a factor without quantum step
      const lf: [bigint, bigint] = [g, N / g];
      emit({
        label: 'Lucky GCD',
        description: `Attempt ${attempt}: picked a = ${a}. gcd(${a}, ${N}) = ${g} — factor found classically without quantum step!`,
        data: { a, g, factors: lf },
        success: true
      });
      factors = lf;
      break;
    }

    emit({
      label: 'Random base',
      description: `Attempt ${attempt}: picked a = ${a}. gcd(${a}, ${N}) = 1 — proceeding to order finding.`,
      data: { a, g },
      success: true
    });

    // ── Order finding (simulated quantum subroutine) ──────────────────────
    // The period r is the only thing a real quantum computer would extract.
    // We find the true r by direct search (fast for N < 10,000), then model
    // the quantum measurement faithfully below.

    const r = classicalOrderFind(a, N, 10000);
    if (r === null) {
      emit({ label: 'Order not found', description: `Could not find the order of ${a} mod ${N} within the iteration limit. Retrying with a different base.`, data: null, success: false, retryReason: 'order not found' });
      continue;
    }

    // Period table: f(x) = a^x mod N for x = 0 … 2r (capped at 200 columns).
    const tableLen = Math.min(Number(r) * 2 + 1, 200);
    const table: Array<{ x: number; fx: number }> = [];
    for (let x = 0; x < tableLen; x++) {
      table.push({ x, fx: Number(modPow(a, BigInt(x), N)) });
    }
    emit({
      label: 'Period table',
      description: `f(x) = ${a}^x mod ${N} is periodic with period r = ${r} — the value the quantum step finds. (Order computed by direct search; the quantum order-finding is simulated.)`,
      data: { table, period: Number(r), a: Number(a), N: Number(N) },
      success: true
    });

    // QFT measurement: sample from the ideal distribution (peaks at k·Q/r),
    // then recover the order from the sampled phase via continued fractions —
    // re-sampling when a measurement lands on an unhelpful peak (k sharing a
    // factor with r), exactly as a real run would.
    const dist = computeQFTDistribution(Number(r), Q);
    const peakList = Array.from({ length: Math.min(Number(r), 8) }, (_, k) => Math.round((k * Q) / Number(r)));
    const peakStr = peakList.join(', ') + (Number(r) > 8 ? ', …' : '');

    let measuredM = sampleQFTMeasurement(dist);
    let convergents = continuedFractionConvergents(BigInt(measuredM), Qn, N);
    let recovered = convergents.find(c => c.den >= 2n && modPow(a, c.den, N) === 1n)?.den ?? null;

    for (let mTry = 1; recovered === null && mTry < 6; mTry++) {
      emit({
        label: 'QFT measurement',
        description: `Sampled m = ${measuredM} → phase ${measuredM}/${Q}. Continued fractions gave no denominator with ${a}^r ≡ 1 mod ${N} (peak shared a factor with r) — re-running the quantum measurement.`,
        data: { distribution: dist, measured: measuredM, Q, r: Number(r) },
        success: false,
        retryReason: 'measurement not useful'
      });
      measuredM = sampleQFTMeasurement(dist);
      convergents = continuedFractionConvergents(BigInt(measuredM), Qn, N);
      recovered = convergents.find(c => c.den >= 2n && modPow(a, c.den, N) === 1n)?.den ?? null;
    }

    emit({
      label: 'QFT distribution',
      description: `(Simulated) Register Q = ${Q}; the distribution peaks at m = ${peakStr}. Sampled measurement m = ${measuredM}, phase ${measuredM}/${Q}.`,
      data: { distribution: dist, measured: measuredM, Q, r: Number(r) },
      success: true
    });

    emit({
      label: 'Continued fractions',
      description: recovered !== null
        ? `Phase ${measuredM}/${Q} → convergents → r = ${recovered} (verified ${a}^${recovered} ≡ 1 mod ${N} ✓).`
        : `Phase ${measuredM}/${Q}: convergents inconclusive after several measurements; proceeding with the simulated order r = ${r}.`,
      data: { convergents, chosenR: recovered ?? r, m: measuredM, Q: Qn },
      success: true
    });

    // ── Factor extraction ─────────────────────────────────────────────────

    if (r % 2n !== 0n) {
      emit({ label: 'Bad period', description: `r = ${r} is odd — cannot compute a^(r/2). Retrying with different a.`, data: { a, r }, success: false, retryReason: 'odd r' });
      continue;
    }

    const half = modPow(a, r / 2n, N);

    if (half === N - 1n) {
      emit({ label: 'Bad period', description: `a^(r/2) = ${half} ≡ -1 (mod ${N}) — trivial square root. Retrying with different a.`, data: { a, r, half }, success: false, retryReason: 'trivial square root' });
      continue;
    }

    const p = gcd(half - 1n, N);
    const q = gcd(half + 1n, N);

    const success = p > 1n && q > 1n && p * q === N;

    emit({
      label: 'Factors found',
      description: success
        ? `gcd(${half}−1, ${N}) = ${p}, gcd(${half}+1, ${N}) = ${q}. Verification: ${p} × ${q} = ${N} ✓`
        : `gcd(${half}−1, ${N}) = ${p}, gcd(${half}+1, ${N}) = ${q}. Factor extraction failed — retrying.`,
      data: { a, r, half, p, q },
      success
    });

    if (success) {
      factors = [p, q];
      break;
    }
  }

  return {
    N,
    factors,
    steps,
    attempts,
    totalTime: performance.now() - startTime
  };
}
