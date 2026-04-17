/**
 * Core arithmetic for Shor's algorithm.
 * All operations use BigInt — no floating point in the number theory layer.
 */

/**
 * Extended Euclidean Algorithm.
 * Returns { gcd, x, y } such that a·x + b·y = gcd(a, b).
 */
export function extGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  if (b === 0n) return { gcd: a, x: 1n, y: 0n };
  const { gcd: g, x: x1, y: y1 } = extGcd(b, a % b);
  return { gcd: g, x: y1, y: x1 - (a / b) * y1 };
}

/**
 * Greatest common divisor.
 */
export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Fast modular exponentiation: base^exp mod mod.
 * Square-and-multiply. O(log exp) multiplications.
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Integer square root (floor).
 * Returns largest k such that k^2 <= n.
 */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt: negative input');
  if (n < 2n) return n;
  // Newton's method
  let x = BigInt(Math.ceil(Math.sqrt(Number(n))));
  // Correct for potential floating-point inaccuracy
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/**
 * Check if n is a perfect power: n = a^b for integer a,b >= 2.
 */
export function checkPerfectPower(n: bigint): { isPerfectPower: boolean; base?: bigint; exp?: bigint } {
  if (n < 4n) return { isPerfectPower: false };

  // Maximum exponent: 2^b <= n → b <= log2(n)
  const maxExp = BigInt(Math.ceil(Math.log2(Number(n))));

  for (let b = 2n; b <= maxExp; b++) {
    // a = floor(n^(1/b)) — use floating point to get close, then verify
    const approx = BigInt(Math.round(Math.pow(Number(n), 1 / Number(b))));
    for (let delta = -2n; delta <= 2n; delta++) {
      const a = approx + delta;
      if (a < 2n) continue;
      if (a ** b === n) return { isPerfectPower: true, base: a, exp: b };
    }
  }
  return { isPerfectPower: false };
}

/**
 * Classical order finding: finds smallest r such that a^r ≡ 1 (mod n).
 * Only for toy numbers (n < 1000). Returns r or null if not found within maxIter.
 */
export function classicalOrderFind(a: bigint, n: bigint, maxIter: number): bigint | null {
  let x = a % n;
  for (let r = 1n; r <= BigInt(maxIter); r++) {
    if (x === 1n) return r;
    x = (x * a) % n;
  }
  return null;
}

/**
 * Continued fraction convergents of p/q up to max denominator.
 * Returns array of { num, den } convergents in order.
 */
export function continuedFractionConvergents(
  p: bigint,
  q: bigint,
  maxDen: bigint
): Array<{ num: bigint; den: bigint }> {
  const convergents: Array<{ num: bigint; den: bigint }> = [];
  let h0 = 1n, h1 = 0n;
  let k0 = 0n, k1 = 1n;
  let a = p;
  let b = q;

  while (b !== 0n) {
    const ai = a / b;
    const h2 = ai * h0 + h1;
    const k2 = ai * k0 + k1;
    if (k2 > maxDen) break;
    convergents.push({ num: h2, den: k2 });
    h1 = h0; h0 = h2;
    k1 = k0; k0 = k2;
    const tmp = b;
    b = a % b;
    a = tmp;
  }

  return convergents;
}
