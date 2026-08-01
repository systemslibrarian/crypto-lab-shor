/**
 * QFT probability distribution — classically simulated.
 *
 * The Quantum Fourier Transform creates interference that peaks sharply
 * at m = k·Q/r for k = 0, 1, ..., r-1.
 *
 * All computations use floating-point (acceptable here — this is visualization
 * layer only, not number theory).
 */

/**
 * Compute the QFT measurement probability distribution for Shor's algorithm.
 *
 * For order r, register size Q = 2^(2L), and M = ⌊Q/r⌋ terms in the sum:
 *   P(m) = (1/(Q·M)) · |sin(π·M·m·r/Q)|² / |sin(π·m·r/Q)|²
 * Peaks sharply at m = k·Q/r for k = 0,1,...,r-1.
 *
 * For large Q, we only compute near expected peaks (within ±4 of k·Q/r)
 * to keep computation tractable. When the order r is large we render only the
 * first `maxPeaks` peaks so the chart stays legible; the full distribution has
 * r equiprobable peaks. Returns at most 500 data points.
 *
 * This function is the CHART only. It is deliberately truncated, so it must not
 * be used to draw a measurement — sampling from a truncated prefix would make
 * every outcome land in the first `maxPeaks` peaks, which is not what a quantum
 * measurement does. Use `sampleQFTMeasurement(r, Q)` for that; it samples over
 * all r peaks.
 *
 * (Classically simulated — not a real quantum measurement.)
 */
export function computeQFTDistribution(
  r: number,
  Q: number,
  maxPeaks = 48,
  /**
   * Extra outcomes that must appear in the chart even if they fall outside the
   * first `maxPeaks` peaks — pass the sampled measurement here so the UI always
   * has a bar to highlight for it.
   */
  alsoInclude: number[] = []
): Array<{ m: number; probability: number; peak: boolean }> {
  const results: Array<{ m: number; probability: number; peak: boolean }> = [];
  const visited = new Set<number>();
  const WIN = 4;
  const peaksShown = Math.min(r, maxPeaks);
  // M = number of terms summed in the QFT (floor(Q/r))
  const M = Math.floor(Q / r);

  /**
   * P(m) = (1/(Q·M)) * |Σ_{j=0}^{M-1} e^{2πi·j·m·r/Q}|²
   *
   * For integer m with alpha = m*r/Q:
   *   If alpha is an integer (exact peak): |Σ|² = M²  → P = M/Q
   *   Otherwise: |Σ|² = sin²(π·M·alpha) / sin²(π·alpha) → P = that/(Q·M)
   *
   * The values returned below drop the constant 1/M factor (the shape is what
   * the chart and the sampler need) and are renormalised over the sampled
   * window before use.
   *
   * In practice for integer m, alpha is integer iff m*r ≡ 0 (mod Q).
   * We handle the limit explicitly to avoid 0/0.
   */
  function prob(m: number): number {
    const alpha = (m * r) / Q;
    const sinDen = Math.sin(Math.PI * alpha);
    if (Math.abs(sinDen) < 1e-9) {
      // Exact peak: |Σ|² = M²
      return (M * M) / Q;
    }
    const sinNum = Math.sin(Math.PI * M * alpha);
    return (sinNum * sinNum) / (sinDen * sinDen * Q);
  }

  // Sample near each expected peak k·Q/r
  for (let k = 0; k < peaksShown; k++) {
    const center = Math.round((k * Q) / r);
    for (let dm = -WIN; dm <= WIN; dm++) {
      const m = ((center + dm) % Q + Q) % Q;
      if (visited.has(m)) continue;
      visited.add(m);
      const isPeak = dm === 0;
      results.push({ m, probability: prob(m), peak: isPeak });
    }
  }

  // Make sure the sampled outcome (and its peak) is represented, even when it
  // came from a peak beyond `maxPeaks`.
  for (const extra of alsoInclude) {
    const kExtra = Math.round((extra * r) / Q);
    const center = Math.round((kExtra * Q) / r);
    for (const m0 of [center, extra]) {
      for (let dm = -WIN; dm <= WIN; dm++) {
        const m = ((m0 + dm) % Q + Q) % Q;
        if (visited.has(m)) continue;
        visited.add(m);
        results.push({ m, probability: prob(m), peak: m === center });
      }
    }
  }

  // Normalize
  const total = results.reduce((s, x) => s + x.probability, 0);
  if (total > 0) {
    for (const item of results) item.probability /= total;
  }

  // Sort by m
  results.sort((a, b) => a.m - b.m);

  return results.slice(0, 500);
}

/** Uniform value in [0, 1) drawn from crypto.getRandomValues. */
function randomUnit(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x1_0000_0000;
}

/**
 * Sample a measurement outcome m from the FULL QFT distribution for order r
 * and register size Q — all r peaks, not a truncated prefix.
 *
 * The distribution is a comb of r equiprobable peaks at m ≈ k·Q/r for
 * k = 0 … r-1, each smeared by the Dirichlet kernel. So we sample in two
 * stages, which is exactly equivalent to sampling the joint distribution but
 * costs O(1) instead of O(Q):
 *
 *   1. Draw k uniformly from {0, …, r-1}. (The peaks carry equal mass.)
 *   2. Draw the offset dm within ±WIN of that peak, weighted by the local
 *      Dirichlet-kernel shape.
 *
 * Which k you land on is the whole point of the post-processing step: when
 * gcd(k, r) > 1 the continued-fraction expansion recovers a proper divisor of
 * r rather than r itself, and the run has to be repeated. Sampling k uniformly
 * over the true range is what makes that failure rate come out right.
 *
 * (Classically simulated — not a real quantum measurement.)
 */
export function sampleQFTMeasurement(r: number, Q: number, win = 4): number {
  const M = Math.floor(Q / r);

  function prob(m: number): number {
    const alpha = (m * r) / Q;
    const sinDen = Math.sin(Math.PI * alpha);
    if (Math.abs(sinDen) < 1e-9) return (M * M) / Q;
    const sinNum = Math.sin(Math.PI * M * alpha);
    return (sinNum * sinNum) / (sinDen * sinDen * Q);
  }

  // 1. Uniform peak index k in [0, r).
  const k = Math.min(r - 1, Math.floor(randomUnit() * r));
  const center = Math.round((k * Q) / r);

  // 2. Local offset, weighted by the kernel shape around that peak.
  const local: Array<{ m: number; p: number }> = [];
  let total = 0;
  for (let dm = -win; dm <= win; dm++) {
    const m = (((center + dm) % Q) + Q) % Q;
    const p = prob(m);
    local.push({ m, p });
    total += p;
  }
  if (total <= 0) return center;

  const u = randomUnit() * total;
  let acc = 0;
  for (const item of local) {
    acc += item.p;
    if (u <= acc) return item.m;
  }
  return local[local.length - 1]!.m;
}
