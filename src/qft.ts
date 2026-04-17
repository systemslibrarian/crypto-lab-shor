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
 * For order r and register size Q = 2^(2L):
 *   P(m) ∝ |sin(π·m·r/Q)|² / |sin(π·m/Q)|²
 * Peaks sharply at m = k·Q/r for k = 0,1,...,r-1.
 *
 * For large Q, we only compute near expected peaks (within ±4 of k·Q/r)
 * to keep computation tractable. Returns at most 500 data points.
 *
 * (Classically simulated — not a real quantum measurement.)
 */
export function computeQFTDistribution(
  r: number,
  Q: number
): Array<{ m: number; probability: number; peak: boolean }> {
  const results: Array<{ m: number; probability: number; peak: boolean }> = [];
  const visited = new Set<number>();
  const WIN = 4;
  // M = number of terms summed in the QFT (floor(Q/r))
  const M = Math.floor(Q / r);

  /**
   * P(m) = (1/Q) * |Σ_{j=0}^{M-1} e^{2πi·j·m·r/Q}|²
   *
   * For integer m with alpha = m*r/Q:
   *   If alpha is an integer (exact peak): |Σ|² = M²  → P = M²/Q
   *   Otherwise: |Σ|² = sin²(π·M·alpha) / sin²(π·alpha) → P = that/Q
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
  for (let k = 0; k < r; k++) {
    const center = Math.round((k * Q) / r);
    for (let dm = -WIN; dm <= WIN; dm++) {
      const m = ((center + dm) % Q + Q) % Q;
      if (visited.has(m)) continue;
      visited.add(m);
      const isPeak = dm === 0;
      results.push({ m, probability: prob(m), peak: isPeak });
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

/**
 * Sample a measurement outcome m from the QFT distribution.
 * Uses crypto.getRandomValues for weighted sampling.
 */
export function sampleQFTMeasurement(
  distribution: Array<{ m: number; probability: number }>
): number {
  // Build CDF
  let cumulative = 0;
  const cdf: Array<{ m: number; threshold: number }> = distribution.map(item => {
    cumulative += item.probability;
    return { m: item.m, threshold: cumulative };
  });

  // Get a uniform random value in [0, 1) using crypto.getRandomValues
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const u = buf[0]! / 0x1_0000_0000;

  // Find the first entry where threshold >= u
  for (const entry of cdf) {
    if (u <= entry.threshold) return entry.m;
  }
  return cdf[cdf.length - 1]!.m;
}
