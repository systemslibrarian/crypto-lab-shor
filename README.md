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

**[systemslibrarian.github.io/crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/)**

Enter any composite integer N (4–9999), pick a preset, or type your own. Press **Run Shor's Algorithm** to watch the four-stage pipeline execute with animated step logs, a period table bar chart, QFT probability distribution visualization, and continued fraction convergent table. The RSA Impact panel shows factoring complexity comparisons and quantum resource estimates for real-world key sizes.

## What Can Go Wrong

- Period finding fails when the random base `a` shares a factor with N, or when the recovered period `r` is odd or yields a^(r/2) ≡ -1 (mod N) — these cases produce only trivial factors and force a restart with a new base.
- The QFT measurement is probabilistic: a run can land on a peak that does not reveal the true period, so several runs may be needed.
- Continued-fraction convergents can return a divisor of the period rather than the period itself, which is why the a^r ≡ 1 (mod N) check is required before trusting a result.
- The simulation classically tracks the full state, so it only scales to small N (the demo caps at N < 10,000) — it is not a quantum computer.
- Misreading the threat scope: Shor breaks factoring and discrete log (RSA, ECC, classical DH) but not symmetric ciphers or hashes beyond Grover's quadratic speedup.

## Real-World Usage

- It is the central reason NIST standardized post-quantum schemes (FIPS 203/204/205) to replace RSA and ECC.
- It motivates "harvest now, decrypt later" risk modeling, where traffic captured today could be decrypted once a large fault-tolerant quantum computer exists.
- It is the benchmark target for quantum hardware and resource-estimation research (logical qubit counts and error-correction overhead to factor RSA-2048).
- It informs cryptographic-agility and key-rotation planning for systems with long confidentiality lifetimes.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-shor
cd crypto-lab-shor
npm install
npm run dev
```

## Related Demos

- [crypto-lab-grover](https://systemslibrarian.github.io/crypto-lab-grover/) — the other landmark quantum attack, applying amplitude amplification to symmetric key search.
- [crypto-lab-rsa-forge](https://systemslibrarian.github.io/crypto-lab-rsa-forge/) — the RSA primitive Shor breaks, shown with its classical attacks.
- [crypto-lab-harvest-vault](https://systemslibrarian.github.io/crypto-lab-harvest-vault/) — harvest-now-decrypt-later and Q-Day timelines that follow directly from Shor.
- [crypto-lab-pq-families](https://systemslibrarian.github.io/crypto-lab-pq-families/) — the post-quantum families standardized to resist Shor.
- [crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/) — quantum key distribution, the quantum side of the post-quantum story.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
