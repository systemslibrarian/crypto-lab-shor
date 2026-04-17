# crypto-lab-shor — Shor's Algorithm: The Reason Everything Changed

> "Whether therefore ye eat, or drink, or whatsoever ye do, do all to the glory of God."  
> — 1 Corinthians 10:31

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-shor/**

## What It Is

Browser-based simulation of Shor's quantum factoring algorithm (Peter Shor,
1994) — the algorithm that made post-quantum cryptography necessary. Every
NIST post-quantum standard exists because of what this algorithm proved: that
a sufficiently large quantum computer can factor any integer in polynomial
time O((log N)³), compared to the sub-exponential classical best.

Simulates the complete four-step algorithm with full step-by-step tracing:
classical pre-checks, period finding via modular exponentiation (with period
table visualization for small N), Quantum Fourier Transform probability
distribution (analytically computed), continued fraction extraction of the
period, and classical factor recovery. All quantum steps are clearly labeled
as classically simulated. No backends. No simulated shortcuts — the number
theory is real.

## When to Use It

- Understanding **WHY** RSA breaks — not just that quantum computers threaten it
- Seeing the period-finding insight that connects modular arithmetic to QFT
- Teaching the continued fraction step that converts a QFT measurement to a period
- Comparing the complexity gap between classical GNFS and Shor's algorithm
- Understanding that Shor also breaks ECC and Diffie-Hellman via discrete log

## What It Does

The demo runs the four steps of Shor's algorithm with animated, step-by-step output:

1. **Classical pre-checks** — detects trivial cases (even N, perfect powers, lucky GCD)
2. **Order finding** — for N ≤ 1000: shows the full period table f(x) = aˣ mod N; for N > 1000: uses QFT probability distribution simulation
3. **Continued fraction extraction** — converts the QFT measurement phase to the period r
4. **Factor extraction** — computes gcd(a^(r/2) ± 1, N)

The qubit count display reflects the actual resource requirement: `3·⌈log₂N⌉ + 3` logical qubits.

## What Can Go Wrong

- **Bad choice of a:** If a^(r/2) ≡ -1 (mod N) or r is odd, the attempt fails and the algorithm retries with a different a. This happens with probability ≤ 1/2 per attempt — on average 2 attempts suffice.
- **QFT measurement miss:** The QFT peaks at k·Q/r, but a wrong k can produce a convergent that doesn't satisfy a^r ≡ 1 (mod N). The algorithm retries. In the demo this is shown explicitly.
- **N = p (prime):** Shor's algorithm does not factor primes. The algorithm detects this via failed order finding. Use a semiprime as input.
- **Classical simulation limits:** The browser simulation runs in polynomial time for N < 10,000. For larger N the QFT distribution is computed analytically. Real quantum advantage requires actual quantum hardware.

## Real-World Usage

As of 2026, the largest fault-tolerant quantum demonstrations have factored
numbers with ~10 bits. RSA-2048 requires ~4,100 logical qubits (Gidney, 2025
estimate). ECC P-256 requires ~2,330 logical qubits (Google, 2026 whitepaper).
Neither is achievable with current hardware. The "harvest now, decrypt later"
threat is real regardless: adversaries collecting RSA-encrypted data today
can decrypt it once sufficient quantum hardware exists.

Migration path: NIST FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA).

## Stack

Vite + TypeScript strict + vanilla CSS. No external libraries. WebCrypto for randomness only. GitHub Pages deployment.

## Related

- [crypto-lab-kyber-vault](https://systemslibrarian.github.io/crypto-lab-kyber-vault/) — post-quantum replacement (ML-KEM)
- [crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/) — physics-based alternative (QKD)
