# crypto-lab-shor

## What It Is

Shor's algorithm (Peter Shor, 1994) is a quantum algorithm that factors integers in polynomial time O((log N)³), rendering RSA, ECC, and all discrete-logarithm-based cryptosystems insecure against a sufficiently large quantum computer. This demo simulates the complete algorithm — classical pre-checks, modular exponentiation period finding, Quantum Fourier Transform probability distribution, continued fraction extraction, and GCD-based factor recovery — entirely in the browser with no backends. The security model it breaks is asymmetric public-key cryptography; it does not threaten symmetric ciphers or hash functions beyond Grover's quadratic speedup.

## When to Use It

- **Understanding why RSA and ECC break** — the demo walks through the period-finding insight that connects modular arithmetic to quantum phase estimation, making the threat concrete rather than abstract.
- **Teaching the QFT-to-period pipeline** — students can see the QFT probability distribution peaks, the continued fraction convergents, and the a^r ≡ 1 (mod N) verification step by step.
- **Comparing classical vs. quantum factoring complexity** — the built-in RSA Impact panel shows the exponential-to-polynomial gap between GNFS and Shor for real key sizes.
- **Motivating post-quantum migration** — the resource requirements table shows how close (or far) current quantum hardware is from breaking RSA-2048 and ECC P-256.
- **Do NOT use this as a real factoring tool** — the browser simulation handles N < 10,000; real quantum advantage requires fault-tolerant quantum hardware that does not yet exist at the required scale.

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-shor/**

Enter any composite integer N (4–9999), pick a preset, or type your own. Press **Run Shor's Algorithm** to watch the four-stage pipeline execute with animated step logs, a period table bar chart, QFT probability distribution visualization, and continued fraction convergent table. The RSA Impact panel shows factoring complexity comparisons and quantum resource estimates for real-world key sizes.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-shor
cd crypto-lab-shor
npm install
npm run dev
```

## Part of the Crypto-Lab Suite

> One of 60+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
