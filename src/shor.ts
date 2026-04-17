/**
 * Shor's Algorithm Engine
 *
 * Implements the complete four-step algorithm with full step-by-step tracing.
 * For N <= 1000: classicalOrderFind is used for order finding (toy mode).
 * For N > 1000: QFT probability distribution simulation is used.
 *
 * All quantum steps are classically simulated and labeled as such.
 */

import {
  gcd,
  modPow,
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
    return { N, factors: null, steps, attempts: 0, totalTime: performance.now() - startTime };
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

  emit({
    label: 'Pre-check',
    description: `N = ${N} is odd, not a perfect power, and ≥ 4. Proceeding to quantum order finding.`,
    data: { N },
    success: true
  });

  // ── Steps 2–4: Loop with retries ─────────────────────────────────────────

  const toyMode = N <= 1000n;
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

    // ── Order finding ─────────────────────────────────────────────────────

    let r: bigint | null = null;

    if (toyMode) {
      // Build period table: f(x) = a^x mod N for x = 0 .. 4r (capped at 200)
      const rClassical = classicalOrderFind(a, N, 10000);
      if (rClassical === null) {
        emit({ label: 'Order not found', description: `Could not find order of ${a} mod ${N} within iteration limit. Retrying.`, data: null, success: false, retryReason: 'order not found' });
        continue;
      }
      r = rClassical;

      const tableLen = Number(r) * 2 + 1;
      const table: Array<{ x: number; fx: number }> = [];
      for (let x = 0; x < Math.min(tableLen, 200); x++) {
        table.push({ x, fx: Number(modPow(a, BigInt(x), N)) });
      }

      emit({
        label: 'Period table',
        description: `f(x) = ${a}^x mod ${N} — period r = ${r} (computed classically for toy-mode N ≤ 1000).`,
        data: { table, period: Number(r), a: Number(a), N: Number(N) },
        success: true
      });

      // Also show QFT distribution for educational purposes
      const dist = computeQFTDistribution(Number(r), Q);
      const measuredM = await sampleQFTMeasurement(dist);
      emit({
        label: 'QFT distribution',
        description: `(Classically simulated) Q = ${Q}, expected peaks at m = ${Array.from({ length: Number(r) }, (_, k) => Math.round(k * Q / Number(r))).join(', ')}. Sampled m = ${measuredM}.`,
        data: { distribution: dist, measured: measuredM, Q, r: Number(r) },
        success: true
      });
    } else {
      // Quantum simulation mode: use QFT distribution to find r
      // We simulate: pick m, run continued fractions to find r
      // We try multiple measurements if needed
      let foundR = false;
      for (let mAttempt = 0; mAttempt < 5 && !foundR; mAttempt++) {
        // For large N we don't know r; simulate by trying candidate orders
        // via a broad QFT distribution then continued fractions
        const broadDist = computeQFTBroad(Q);
        const m = await sampleQFTMeasurement(broadDist);
        const convergents = continuedFractionConvergents(BigInt(m), Qn, N);

        emit({
          label: 'QFT measurement',
          description: `(Classically simulated) Q = ${Q}, measured m = ${m}, phase ≈ ${m}/${Q}.`,
          data: { distribution: broadDist.slice(0, 100), measured: m, Q },
          success: true
        });

        for (const conv of convergents) {
          if (conv.den >= 2n && modPow(a, conv.den, N) === 1n) {
            r = conv.den;
            emit({
              label: 'Continued fractions',
              description: `Phase ${m}/${Q} → convergents → r = ${r} (${a}^${r} ≡ 1 mod ${N} ✓).`,
              data: { convergents, chosenR: r, m, Q: Qn },
              success: true
            });
            foundR = true;
            break;
          }
        }

        if (!foundR) {
          emit({
            label: 'Continued fractions',
            description: `Phase ${m}/${Q}: no convergent denominator satisfies a^r ≡ 1 mod ${N}. Re-sampling QFT.`,
            data: { convergents, m, Q: Qn },
            success: false
          });
        }
      }

      if (r === null) {
        emit({ label: 'Order not found', description: `Could not determine order for a = ${a} mod ${N} via QFT simulation. Retrying.`, data: null, success: false, retryReason: 'QFT order not found' });
        continue;
      }
    }

    // For toy mode, also run continued fractions on the QFT sample
    if (toyMode && r !== null) {
      // Continued fractions step: use QFT measurement
      // We already have r from classical search; show the CF step on the QFT measurement
      const lastQFTStep = steps.findLast(s => s.label === 'QFT distribution');
      if (lastQFTStep) {
        const stepData = lastQFTStep.data as { measured: number; Q: number };
        const m = stepData.measured;
        const convergents = continuedFractionConvergents(BigInt(m), Qn, N);
        // Check if continued fractions would recover r
        const cfR = convergents.find(c => c.den >= 2n && modPow(a, c.den, N) === 1n);
        emit({
          label: 'Continued fractions',
          description: cfR
            ? `Phase ${m}/${Q} → convergents → r = ${cfR.den} ✓ (confirms classical result r = ${r}).`
            : `Phase ${m}/${Q} → convergents tried (sampled m may not yield exact period; classical r = ${r} confirmed).`,
          data: { convergents, chosenR: cfR?.den ?? r, m, Q: Qn },
          success: true
        });
      }
    }

    if (r === null) continue;

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

/**
 * Broad QFT distribution for quantum simulation mode (unknown r).
 * Samples uniformly across Q to let continued fractions find the period.
 */
function computeQFTBroad(Q: number): Array<{ m: number; probability: number }> {
  // Sample 200 evenly-spaced points — continued fractions will find r
  const count = Math.min(200, Q);
  const step = Math.floor(Q / count);
  const dist: Array<{ m: number; probability: number }> = [];
  for (let i = 1; i < count; i++) {
    dist.push({ m: i * step, probability: 1 / count });
  }
  return dist;
}
