/**
 * Functional coverage for the claims the Shor demo makes on screen.
 *
 * The a11y suite drives a full run but reads none of the output, so no verdict,
 * chart or failure path was asserted. These tests read the rendered DOM and
 * check the page's numbers against each other and against the modular
 * arithmetic redone here: the factors in the result banner must multiply to N
 * and must be the two gcds the live explainer derived; the period chart's bars
 * must actually be a^x mod N and actually repeat with the period its title
 * claims; the QFT peaks must sit at k·Q/r; the convergent the table crowns must
 * genuinely satisfy a^r ≡ 1 (mod N); and the phasors must add on-peak and
 * cancel off-peak. A hardcoded expectation would pass against a page computing
 * nonsense consistently — these do not.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto('.');
  await expect(page.locator('#run-btn')).toBeVisible();
  // The bar charts fade in one bar at a time; nothing here depends on the
  // animation, and waiting it out on every assertion would be slow.
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;opacity:1!important}`,
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

// ---------------------------------------------------------------------------
// Arithmetic, redone here so the page's output can be checked against it
// ---------------------------------------------------------------------------

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = ((base % m) + m) % m;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capture(haystack: string, re: RegExp, what: string): string {
  const m = haystack.match(re);
  expect(m, `${what} not found in: ${haystack}`).not.toBeNull();
  return m![1]!;
}

const big = (haystack: string, re: RegExp, what: string): bigint =>
  BigInt(capture(haystack, re, what));
const int = (haystack: string, re: RegExp, what: string): number =>
  Number(capture(haystack, re, what));

const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

async function textOf(locator: Locator): Promise<string> {
  return flat(await locator.innerText());
}

/**
 * Run N and wait for the banner. Shor is randomised: a run can short-circuit
 * on a lucky gcd and emit no quantum visualisation, which is correct behaviour.
 * Retry until a run takes the quantum path, exactly as the a11y suite does.
 */
async function runQuantum(page: Page, n: number, minAttempts = 1): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 30_000 });
    await page.locator('#n-input').fill(String(n));
    await page.locator('#run-btn').click();
    await expect(page.locator('.result-banner')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 30_000 });
    const bases = await page.locator('.step-entry').filter({ hasText: 'Random base' }).count();
    const factored = await page.locator('.result-banner').innerText();
    if (bases >= minAttempts && /RESULT:/.test(factored)) return;
    await page.locator('#reset-btn').click();
  }
  throw new Error(`no run with >= ${minAttempts} order-finding attempts after 30 tries`);
}

interface Banner {
  n: bigint;
  factors: [bigint, bigint];
  attempts: number;
}

async function readBanner(page: Page): Promise<Banner> {
  const text = await textOf(page.locator('.result-banner'));
  const n = big(text, /RESULT: (\d+) =/, 'N');
  const f0 = big(text, /= (\d+) ×/, 'first factor');
  const f1 = big(text, /× (\d+) /, 'second factor');
  const attempts = int(text, /Attempts: (\d+)/, 'attempt count');
  expect(text).toMatch(/Time: \d+ms/);
  return { n, factors: [f0, f1], attempts };
}

/** The live explainer's numbers, as the page rendered them. */
interface Aha {
  a: bigint;
  r: bigint;
  half: bigint;
  p: bigint;
  q: bigint;
}

async function readAha(page: Page): Promise<Aha> {
  const t = await textOf(page.locator('#aha-period-live'));
  return {
    a: big(t, /base a = (\d+)/, 'base a'),
    r: big(t, /period r = (\d+)/, 'period r'),
    half: big(t, /mod \d+ = (\d+),/, 'a^(r/2)'),
    p: big(t, /gcd\(\d+−1, \d+\) = gcd\(\d+, \d+\) = (\d+)/, 'gcd(a^(r/2)−1, N)'),
    q: big(t, /gcd\(\d+\+1, \d+\) = gcd\(\d+, \d+\) = (\d+)/, 'gcd(a^(r/2)+1, N)'),
  };
}

// ---------------------------------------------------------------------------
// The headline result
// ---------------------------------------------------------------------------

test('a successful run: the banner, the explainer and the gcd step all name one factorisation', async ({
  page,
}) => {
  await runQuantum(page, 143);

  const banner = await readBanner(page);
  expect(banner.n).toBe(143n);
  expect(banner.factors[0] * banner.factors[1]).toBe(banner.n);
  expect(banner.factors[0]).toBeGreaterThan(1n);
  expect(banner.factors[1]).toBeGreaterThan(1n);
  expect(banner.attempts).toBeGreaterThanOrEqual(1);

  // The always-visible explainer claims the exact chain that produced them.
  const aha = await readAha(page);
  await expect(page.locator('#aha-period-live')).toHaveAttribute('data-empty', 'false');
  expect(aha.r % 2n, 'the explainer claims r is even').toBe(0n);
  expect(modPow(aha.a, aha.r, banner.n), 'a^r ≡ 1 mod N').toBe(1n);
  expect(modPow(aha.a, aha.r / 2n, banner.n), 'a^(r/2) is what it says').toBe(aha.half);
  expect(aha.half).not.toBe(1n);
  expect(aha.half).not.toBe(banner.n - 1n);
  expect(gcd(aha.half - 1n, banner.n)).toBe(aha.p);
  expect(gcd(aha.half + 1n, banner.n)).toBe(aha.q);
  // "Check: p × q = N ✓" — the claim the explainer actually prints.
  expect(aha.p * aha.q).toBe(banner.n);
  expect([aha.p, aha.q].sort()).toEqual([...banner.factors].sort());

  // The gcd step is the highlighted payoff, and its verification is arithmetic,
  // not decoration.
  const found = page.locator('.step-entry--highlight');
  await expect(found).toHaveCount(1);
  const foundText = await textOf(found);
  expect(foundText).toContain('Factors found');
  const d = big(foundText, /Verification: (\d+) ×/, 'divisor');
  const c = big(foundText, /Verification: \d+ × (\d+)/, 'cofactor');
  const product = big(foundText, /= (\d+) ✓/, 'product');
  expect(d * c).toBe(product);
  expect(product).toBe(banner.n);

  // The call-out beneath the demo repeats the same factorisation.
  const callout = await textOf(page.locator('#live-callout'));
  expect(callout).toContain(
    `factored N = ${banner.n} → ${banner.factors[0]} × ${banner.factors[1]}`,
  );

  // Step tags classify the pipeline, and the resource estimate is self-consistent.
  const resource = await textOf(page.locator('.step-entry').filter({ hasText: 'Resource estimate' }));
  expect(resource).toContain('[QUANTUM]');
  const L = int(resource, /2\^\(2·(\d+)\)/, 'register exponent');
  const Q = int(resource, /= (\d+)\. Logical/, 'register size Q');
  const qubits = int(resource, /\+ 3 = (\d+)/, 'logical qubit count');
  expect(Q).toBe(2 ** (2 * L));
  expect(qubits).toBe(2 * L + 3);
  expect(resource).toContain('classically simulated');

  // The three teaching stages are paced with their banners, in order.
  const stages = await page.locator('.stage-banner').allInnerTexts();
  expect(stages.length).toBeGreaterThanOrEqual(3);
  expect(flat(stages[0]!)).toContain('Stage 1 — found the repeating pattern');
  expect(flat(stages[1]!)).toContain('Stage 2 — measured a frequency spike');
  expect(flat(stages[2]!)).toContain('Stage 3 — recovered the period r');
});

// ---------------------------------------------------------------------------
// The charts
// ---------------------------------------------------------------------------

test('period chart: the bars really are a^x mod N, and really repeat with the stated period', async ({
  page,
}) => {
  await runQuantum(page, 143);
  const N = (await readBanner(page)).n;

  const sections = page.locator('[id^="viz-period-"]');
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const title = flat(await sec.locator('.viz-section__title').first().innerText());
    const a = big(title, /f\(x\) = (\d+)\^x/, 'base a');
    const modulus = big(title, /mod (\d+)/, 'modulus');
    const r = int(title, /period r = (\d+)/, 'period');
    expect(modulus).toBe(N);

    // The chart's own accessible description must repeat the title's numbers.
    const chart = sec.locator('.period-bars');
    await expect(chart).toHaveCount(1);
    const aria = (await chart.getAttribute('aria-label'))!;
    expect(aria).toContain(`f(x) = ${a}^x mod ${N}`);
    expect(aria).toContain(`period r = ${r}`);
    const last = int(aria, /x = 0 to (\d+)/, 'last x');

    // The bars themselves: value by value, against real modular exponentiation.
    const bars = await sec
      .locator('.period-bar')
      .evaluateAll((ns) => ns.map((n) => (n as HTMLElement).title));
    expect(bars).toHaveLength(last + 1);
    expect(bars).toHaveLength(Math.min(r * 2 + 1, 200));
    const fx = bars.map((t, x) => {
      expect(t).toBe(`x=${x}  f(x)=${capture(t, /f\(x\)=(\d+)/, 'f(x)')}`);
      return BigInt(capture(t, /f\(x\)=(\d+)/, 'f(x)'));
    });
    fx.forEach((v, x) => expect(v, `f(${x})`).toBe(modPow(a, BigInt(x), N)));

    // Periodicity is the whole point of the chart.
    expect(fx[0]).toBe(1n);
    expect(fx[r]).toBe(1n);
    for (let x = 0; x + r < fx.length; x++) expect(fx[x + r], `f(${x + r}) = f(${x})`).toBe(fx[x]!);
    // r is the *least* such period, not merely a period.
    for (let d = 1; d < r; d++) expect(fx[d], `f(${d}) must not be 1`).not.toBe(1n);

    // The highlighted bars are exactly the returns to 1 after x = 0.
    const marked = await sec
      .locator('.period-bar--period')
      .evaluateAll((ns) => ns.map((n) => Number((n as HTMLElement).title.match(/x=(\d+)/)![1])));
    expect(marked).toEqual(fx.map((v, x) => (v === 1n && x > 0 ? x : -1)).filter((x) => x >= 0));
    expect(marked.every((x) => x % r === 0)).toBe(true);
  }
});

test('qft chart: the peaks sit at k·Q/r, and exactly one bar is the measurement', async ({
  page,
}) => {
  await runQuantum(page, 143);

  const sections = page.locator('[id^="viz-qft-"]');
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const title = flat(await sec.locator('.viz-section__title').first().innerText());
    expect(title).toContain('classically simulated');
    const Q = int(title, /Q = (\d+)/, 'register size');
    const r = int(title, /r = (\d+)/, 'period');

    const chart = sec.locator('.qft-bars-wrapper');
    await expect(chart).toHaveCount(1);
    const aria = (await chart.getAttribute('aria-label'))!;
    expect(int(aria, /multiples of Q\/r ≈ (\d+)/, 'peak spacing')).toBe(Math.round(Q / r));
    const measured = int(aria, /sampled measurement was m = (\d+)/, 'sampled m');

    // The note under the chart names the same measurement.
    const note = flat(await sec.locator('div[style*="font-size"]').first().innerText());
    expect(note).toContain(`Sampled measurement: m = ${measured}`);

    const bars = await sec
      .locator('.qft-bar')
      .evaluateAll((ns) =>
        ns.map((n) => ({
          title: (n as HTMLElement).title,
          peak: n.classList.contains('qft-bar--peak'),
          sampled: n.classList.contains('qft-bar--sampled'),
        })),
      );
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThanOrEqual(500);

    // Exactly one sampled bar, and it is the m everything else names.
    const sampled = bars.filter((b) => b.sampled);
    expect(sampled).toHaveLength(1);
    expect(Number(capture(sampled[0]!.title, /m=(\d+)/, 'sampled bar m'))).toBe(measured);

    // Every peak bar sits at round(k·Q/r) for some k in [0, r), and every peak
    // bar is labelled as one.
    const peaks = bars.filter((b) => b.peak).map((b) => Number(capture(b.title, /m=(\d+)/, 'peak m')));
    expect(peaks.length).toBeGreaterThanOrEqual(Math.min(r, 48));
    expect(peaks.length).toBeLessThanOrEqual(Math.min(r, 48) + 1);
    for (const m of peaks) {
      const k = Math.round((m * r) / Q);
      expect(Math.round((k * Q) / r), `peak m=${m} is not at a multiple of Q/r`).toBe(m);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(r);
      expect(capture(bars.find((b) => b.title.startsWith(`m=${m} `))!.title, /(\(peak\))/, 'peak marker')).toBe(
        '(peak)',
      );
    }
    // Probabilities are a distribution: every bar carries one, and the peaks
    // carry more than the off-peak bars beside them.
    const probs = new Map(
      bars.map((b) => [
        Number(capture(b.title, /m=(\d+)/, 'm')),
        Number(capture(b.title, /p=([\d.]+)/, 'probability')),
      ]),
    );
    for (const m of peaks) {
      const neighbour = probs.get(m + 2) ?? probs.get(m - 2);
      if (neighbour !== undefined) expect(probs.get(m)!).toBeGreaterThan(neighbour);
    }
  }
});

test('phasors: the hands add at an on-peak frequency and cancel off it', async ({ page }) => {
  await runQuantum(page, 143);

  const block = page.locator('.phasor-block').first();
  await expect(block).toBeVisible();
  const buttons = block.locator('.phasor-freq-btn');
  const labels = await buttons.allInnerTexts();
  expect(labels.length).toBeGreaterThanOrEqual(2);
  expect(flat(labels[0]!)).toMatch(/on-peak\s+m = \d+ = \d+·Q\/r/);
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');

  const hands = await block.locator('.phasor-wheel').count();
  expect(hands).toBeGreaterThanOrEqual(2);

  /** Σ as the label says it, cross-checked against the SVG's own description. */
  const resultant = async (): Promise<{ mag: number; adds: boolean }> => {
    const label = flat(await block.locator('.phasor-sum__label').innerText());
    const aria = (await block.locator('.phasor-sum svg').getAttribute('aria-label'))!;
    const mag = Number(capture(label, /Σ = ([\d.]+)/, 'resultant magnitude'));
    expect(Number(capture(aria, /magnitude ([\d.]+) of a possible/, 'aria magnitude'))).toBe(mag);
    expect(int(aria, /of a possible (\d+)/, 'hand count')).toBe(hands);
    const adds = label.includes('✓ add');
    expect(aria).toContain(adds ? 'They add up.' : 'They mostly cancel.');
    return { mag, adds };
  };

  // On-peak: perfect constructive interference — every hand points the same way.
  const onPeak = await resultant();
  expect(onPeak.adds).toBe(true);
  expect(onPeak.mag).toBeCloseTo(hands, 1);
  expect(flat(await block.locator('.phasor-explain').innerText())).toContain('This is a peak');

  // Off-peak: the hands fan out and the resultant collapses.
  const offPeak = buttons.filter({ hasText: 'off-peak' });
  await expect(offPeak).toHaveCount(1);
  await offPeak.click();
  await expect(offPeak).toHaveAttribute('aria-pressed', 'true');
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');

  const off = await resultant();
  expect(off.adds).toBe(false);
  expect(off.mag).toBeLessThan(hands * 0.8);
  const explain = flat(await block.locator('.phasor-explain').innerText());
  expect(explain).toContain('cancel');
  expect(explain).toContain('unlikely measurement');
});

test('continued fractions: the crowned convergent is the first denominator that passes a^r ≡ 1', async ({
  page,
}) => {
  await runQuantum(page, 143);
  const N = (await readBanner(page)).n;

  const sections = page.locator('[id^="viz-cf-"]');
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const title = flat(await sec.locator('.viz-section__title').first().innerText());
    const m = int(title, /phase (\d+) \//, 'measured m');
    const Q = int(title, /\/ (\d+)/, 'register size');

    // The caption ties the table back to the green sampled bar above it.
    const caption = flat(await sec.locator('.cf-caption').innerText());
    expect(caption).toContain(`m/Q = ${m}/${Q}`);
    expect(caption).toContain('green sampled bar');

    // The base is the one this attempt's period chart names.
    const periodTitle = flat(
      await page
        .locator(`#viz-period-${capture(await sec.getAttribute('id'), /viz-cf-(\d+)/, 'attempt')}`)
        .locator('.viz-section__title')
        .first()
        .innerText(),
    );
    const a = big(periodTitle, /f\(x\) = (\d+)\^x/, 'base a');

    const rows = await sec.locator('.convergents tbody tr').evaluateAll((ns) =>
      ns.map((row) => ({
        text: (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        winner: row.classList.contains('conv-winner'),
      })),
    );
    expect(rows.length).toBeGreaterThan(0);

    let seenWinner = false;
    rows.forEach((row, idx) => {
      const num = big(row.text, /(\d+)\/\d+/, `numerator of row ${idx}`);
      const den = big(row.text, /\d+\/(\d+)/, `denominator of row ${idx}`);
      void num;
      const passes = den >= 2n && modPow(a, den, N) === 1n;
      if (row.winner) {
        // The winner must be the FIRST row that passes, and must say so.
        expect(seenWinner, 'more than one winner row').toBe(false);
        expect(passes, `crowned r = ${den} does not satisfy ${a}^${den} ≡ 1 mod ${N}`).toBe(true);
        expect(row.text).toContain(`✓ r = ${den}`);
        expect(row.text).toContain('← the period r');
        seenWinner = true;
      } else {
        expect(passes && !seenWinner, `row ${idx} passes but was not crowned`).toBe(false);
        if (den >= 2n) {
          // A losing row must show the residue it actually produced.
          const shown = row.text.match(/≡ (\d+) mod/);
          if (shown) expect(BigInt(shown[1]!)).toBe(modPow(a, den, N));
        }
      }
    });

    // Only the final attempt is guaranteed to have recovered a period.
    if (i === count - 1) {
      expect(seenWinner, 'the successful attempt crowned no convergent').toBe(true);
      const aha = await readAha(page);
      expect(aha.a).toBe(a);
      const winner = rows.find((row) => row.winner)!;
      expect(big(winner.text, /✓ r = (\d+)/, 'crowned period')).toBe(aha.r);
    }
  }
});

test('retries get their own charts, each under a heading that describes it', async ({ page }) => {
  // Regression: every attempt's period table, QFT distribution and convergents
  // were appended to one section per kind, so a panel headed
  // "f(x) = 133^x mod 143 — period r = 3" also contained the a = 125, r = 20
  // chart that actually produced the factors, and the QFT heading named a Q/r
  // that belonged to a discarded base. 77 retries often enough to reach this.
  await runQuantum(page, 77, 2);

  const attempts = await page.locator('.step-entry').filter({ hasText: 'Random base' }).count();
  expect(attempts).toBeGreaterThanOrEqual(2);

  // One period / QFT / CF section per attempt, and nothing stacked.
  await expect(page.locator('[id^="viz-period-"]')).toHaveCount(attempts);
  await expect(page.locator('[id^="viz-qft-"]')).toHaveCount(attempts);
  await expect(page.locator('[id^="viz-cf-"]')).toHaveCount(attempts);
  await expect(page.locator('.viz-section')).toHaveCount(3 * attempts);

  for (let k = 1; k <= attempts; k++) {
    await expect(page.locator(`#viz-period-${k} .period-bars`)).toHaveCount(1);
    await expect(page.locator(`#viz-qft-${k} .qft-bars-wrapper`)).toHaveCount(1);
    await expect(page.locator(`#viz-qft-${k} .phasor-block`)).toHaveCount(1);
    await expect(page.locator(`#viz-cf-${k} .convergents`)).toHaveCount(1);

    // Each heading describes the chart directly beneath it.
    const title = flat(await page.locator(`#viz-period-${k} .viz-section__title`).first().innerText());
    const aria = (await page.locator(`#viz-period-${k} .period-bars`).getAttribute('aria-label'))!;
    const a = capture(title, /f\(x\) = (\d+)\^x/, 'base a');
    const r = capture(title, /period r = (\d+)/, 'period');
    expect(aria).toContain(`f(x) = ${a}^x`);
    expect(aria).toContain(`period r = ${r}`);

    const qftTitle = flat(await page.locator(`#viz-qft-${k} .viz-section__title`).first().innerText());
    const Q = int(qftTitle, /Q = (\d+)/, 'Q');
    const qftR = int(qftTitle, /r = (\d+)/, 'r');
    expect(qftR).toBe(Number(r));
    const qftAria = (await page.locator(`#viz-qft-${k} .qft-bars-wrapper`).getAttribute('aria-label'))!;
    expect(int(qftAria, /multiples of Q\/r ≈ (\d+)/, 'peak spacing')).toBe(Math.round(Q / qftR));
  }

  // A retry is announced with its reason, not silently swallowed.
  const retries = await page.locator('.step-retry').allInnerTexts();
  expect(retries.length).toBeGreaterThanOrEqual(1);
  for (const r of retries) {
    expect(flat(r)).toMatch(
      /↺ Retrying: (odd r|trivial square root|order not found|measurement not useful|period not recovered)/,
    );
  }
  await expect(page.locator('.step-entry--failure').first()).toContainText('[FAIL]');
});

// ---------------------------------------------------------------------------
// Classical short circuits
// ---------------------------------------------------------------------------

async function runAndWait(page: Page, n: string): Promise<void> {
  await page.locator('#n-input').fill(n);
  await page.locator('#run-btn').click();
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 30_000 });
}

test('classical short circuits: even, perfect power and prime N never reach the quantum step', async ({
  page,
}) => {
  const noQuantumViz = async (): Promise<void> => {
    await expect(page.locator('.viz-section')).toHaveCount(0);
    expect(await textOf(page.locator('#viz-panel'))).toContain(
      'N was resolved classically — no quantum order-finding was needed',
    );
  };

  // Even: 2 comes out without any order finding.
  await runAndWait(page, '100');
  let banner = await readBanner(page);
  expect(banner.factors).toEqual([2n, 50n]);
  expect(banner.factors[0] * banner.factors[1]).toBe(100n);
  expect(banner.attempts).toBe(0);
  expect(await textOf(page.locator('.step-entry'))).toContain('N = 100 is even');
  await noQuantumViz();

  // Perfect power: the degenerate case that bypasses the quantum step.
  await runAndWait(page, '27');
  banner = await readBanner(page);
  expect(banner.factors[0] * banner.factors[1]).toBe(27n);
  const pp = await textOf(page.locator('.step-entry'));
  expect(pp).toContain('Perfect power');
  expect(pp).toContain('N = 27 = 3^3');
  await noQuantumViz();

  // Prime: there is nothing to factor, and the page says so rather than
  // reporting a factorisation.
  await runAndWait(page, '97');
  await expect(page.locator('.result-banner')).toHaveClass(/result-banner--info/);
  const primeBanner = await textOf(page.locator('.result-banner'));
  expect(primeBanner).toBe('━━━ N = 97 is prime — there is nothing to factor. ━━━');
  expect(primeBanner).not.toContain('RESULT:');
  const primeStep = await textOf(page.locator('.step-entry'));
  expect(primeStep).toContain('Prime input');
  expect(primeStep).toContain("Shor's algorithm factors composite numbers");
  await noQuantumViz();
  // No factorisation means no live call-out claiming one.
  await expect(page.locator('#aha-period-live')).toHaveAttribute('data-empty', 'true');
});

// ---------------------------------------------------------------------------
// Input handling and reset
// ---------------------------------------------------------------------------

test('input validation: out-of-range N is refused, named, and never runs', async ({ page }) => {
  const message = 'Please enter a whole number N between 4 and 9999.';

  // The input is type=number, so a browser drops non-digits before the handler
  // ever sees them — '' is the state that leaves.
  for (const bad of ['3', '10000', '0', '']) {
    await page.locator('#n-input').fill(bad);
    await page.locator('#run-btn').click();
    await expect(page.locator('#n-error'), bad).toBeVisible();
    expect(await textOf(page.locator('#n-error')), bad).toBe(message);
    await expect(page.locator('#n-input'), bad).toHaveAttribute('aria-invalid', 'true');
    // Nothing ran: the log still holds its placeholder.
    await expect(page.locator('.result-banner'), bad).toHaveCount(0);
    await expect(page.locator('.step-log__placeholder'), bad).toBeVisible();
    await expect(page.locator('.viz-section'), bad).toHaveCount(0);
  }

  // Typing again clears the error rather than leaving it stale.
  await page.locator('#n-input').fill('15');
  await expect(page.locator('#n-error')).toBeHidden();
  await expect(page.locator('#n-input')).toHaveAttribute('aria-invalid', 'false');
});

test('reset clears the log, the charts and the live explainer', async ({ page }) => {
  await runQuantum(page, 143);
  await expect(page.locator('.viz-section').first()).toBeVisible();
  await expect(page.locator('#aha-period-live')).toHaveAttribute('data-empty', 'false');

  await page.locator('#reset-btn').click();

  await expect(page.locator('.result-banner')).toHaveCount(0);
  await expect(page.locator('.viz-section')).toHaveCount(0);
  await expect(page.locator('.step-log__placeholder')).toBeVisible();
  expect(await textOf(page.locator('#viz-panel'))).toBe(
    'Visualization will appear here after running the algorithm.',
  );
  await expect(page.locator('#aha-period-live')).toHaveAttribute('data-empty', 'true');
  expect(await textOf(page.locator('#aha-period-live'))).toContain(
    'run the algorithm and the exact numbers from your factorisation appear here',
  );
  await expect(page.locator('#run-btn')).toBeEnabled();
  await expect(page.locator('.preset-btn.active')).toHaveCount(0);
});

test('presets run the number on the button they were clicked with', async ({ page }) => {
  const preset = page.locator('.preset-btn').first();
  const n = (await preset.getAttribute('data-n'))!;
  await preset.click();
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 30_000 });

  await expect(page.locator('#n-input')).toHaveValue(n);
  await expect(preset).toHaveClass(/active/);
  await expect(page.locator('.preset-btn.active')).toHaveCount(1);
  expect(await textOf(page.locator('#step-log'))).toContain(`SHOR'S ALGORITHM: N = ${n}`);
  const banner = await readBanner(page);
  expect(banner.n).toBe(BigInt(n));
  expect(banner.factors[0] * banner.factors[1]).toBe(BigInt(n));
});
