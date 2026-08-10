import './style.css';
import { runShor, type ShorStep } from './shor.ts';
import { modPow } from './arithmetic.ts';

// ── Theme toggle ─────────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
function applyTheme(t: string) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '🌙' : '☀️';
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  localStorage.setItem('theme', t);
}
themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});
applyTheme(localStorage.getItem('theme') ?? 'dark');

// Respect users who prefer reduced motion (vestibular safety / ADA).
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── DOM refs ─────────────────────────────────────────────────────────────
const nInput   = document.getElementById('n-input')   as HTMLInputElement;
const runBtn   = document.getElementById('run-btn')   as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const stepLog  = document.getElementById('step-log')  as HTMLDivElement;
const vizPanel = document.getElementById('viz-panel') as HTMLDivElement;
const nError   = document.getElementById('n-error')   as HTMLParagraphElement;
const liveCallout = document.getElementById('live-callout') as HTMLDivElement;
const ahaPeriodLive = document.getElementById('aha-period-live') as HTMLDivElement;

// ── Run state ────────────────────────────────────────────────────────────
// `isRunning` blocks re-entry from every trigger (Run button, Enter, presets),
// not just the Run button's disabled state. `runToken` is bumped to cancel an
// in-flight run (e.g. on Reset) so its async replay loop bails out cleanly.
let isRunning = false;
let runToken = 0;

// ── Preset buttons ───────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isRunning) return;
    nInput.value = btn.dataset['n'] ?? '15';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    handleRun();
  });
});

// ── Step label classifier ────────────────────────────────────────────────
function classifyStep(label: string): { tag: string; cssClass: string } {
  const quantum = ['QFT', 'Quantum', 'qubit', 'Resource'];
  const isQuantum = quantum.some(w => label.toLowerCase().includes(w.toLowerCase()));
  const isFail = label.toLowerCase().includes('bad') || label.toLowerCase().includes('not found');
  if (isFail) return { tag: '[FAIL]', cssClass: 'step-entry--failure' };
  if (isQuantum) return { tag: '[QUANTUM]', cssClass: 'step-entry--quantum' };
  return { tag: '[CLASSICAL]', cssClass: 'step-entry--classical' };
}

// ── Render one step ──────────────────────────────────────────────────────
function renderStep(step: ShorStep, N: bigint): void {
  const { tag, cssClass } = classifyStep(step.label);
  const entry = document.createElement('div');
  entry.className = `step-entry ${cssClass}`;
  // The gcd payoff — Shor's conceptual heart. Highlight it and mirror the exact
  // numbers into the always-visible "Why period-finding factors N" explainer.
  if (step.label === 'Factors found' && step.success) {
    entry.classList.add('step-entry--highlight');
    populateAhaPeriod(step, N);
  }

  const tagSpan = document.createElement('span');
  tagSpan.className = cssClass.includes('quantum')
    ? 'step-tag-quantum' : cssClass.includes('failure')
    ? 'step-tag-failure' : 'step-tag-classical';
  tagSpan.textContent = tag + ' ';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'step-label';
  labelSpan.textContent = step.label;

  const desc = document.createElement('div');
  desc.className = 'step-desc';
  desc.textContent = step.description;

  entry.appendChild(tagSpan);
  entry.appendChild(labelSpan);
  entry.appendChild(desc);

  if (step.retryReason) {
    const retry = document.createElement('div');
    retry.className = 'step-retry';
    retry.textContent = '↺ Retrying: ' + step.retryReason;
    entry.appendChild(retry);
  }

  // Remove placeholder
  stepLog.querySelector('.step-log__placeholder')?.remove();
  stepLog.appendChild(entry);
  stepLog.scrollTop = stepLog.scrollHeight;

  // Render panel B data
  renderViz(step, N);
}

// ── Panel B visualizations ───────────────────────────────────────────────
let vizSections: Record<string, HTMLElement> = {};

/**
 * Which retry attempt the charts being rendered belong to.
 *
 * Shor retries with a fresh base whenever a run hits an odd period, a trivial
 * square root, or an unhelpful measurement, and every attempt emits its own
 * period table, QFT distribution and convergents. Keying the viz sections on
 * this counter keeps each section's title — which names that attempt's a, r, Q
 * and phase — describing the charts actually inside it. Sharing one section per
 * kind stacked every attempt's chart under the first attempt's heading, so a
 * panel titled "f(x) = 133^x mod 143 — period r = 3" also held the a = 125,
 * r = 20 chart that actually produced the factors.
 */
let vizAttempt = 0;

function getVizSection(id: string, title: string): HTMLElement {
  if (vizSections[id]) return vizSections[id];
  vizPanel.querySelector('.viz-panel__placeholder')?.remove();
  const section = document.createElement('div');
  section.className = 'viz-section';
  section.id = 'viz-' + id;
  const h = document.createElement('div');
  h.className = 'viz-section__title';
  h.textContent = title;
  section.appendChild(h);
  vizPanel.appendChild(section);
  vizSections[id] = section;
  return section;
}

function renderViz(step: ShorStep, N: bigint): void {
  if (step.label === 'Period table') {
    const data = step.data as { table: Array<{x:number; fx:number}>; period: number; a: number; N: number };
    const sec = getVizSection(`period-${vizAttempt}`, `f(x) = ${data.a}^x mod ${data.N}  —  period r = ${data.period}`);
    const container = document.createElement('div');
    container.className = 'period-bars';
    // The chart is a single labelled image; the container is keyboard-focusable
    // so it can be scrolled with the arrow keys (WCAG 2.1.1). Individual bars are
    // decorative (their data is in the title tooltip + the label), not focusable.
    container.setAttribute('role', 'img');
    container.setAttribute('tabindex', '0');
    container.setAttribute('aria-label',
      `Bar chart: f(x) = ${data.a}^x mod ${data.N} for x = 0 to ${data.table.length - 1}. The values repeat with period r = ${data.period}.`);
    const maxFx = Math.max(...data.table.map(d => d.fx), 1);
    data.table.forEach((row, i) => {
      const bar = document.createElement('div');
      bar.className = 'period-bar';
      const heightPct = Math.max(4, Math.round((row.fx / maxFx) * 100));
      bar.style.height = heightPct + '%';
      bar.title = `x=${row.x}  f(x)=${row.fx}`;
      if (row.fx === 1 && i > 0) bar.classList.add('period-bar--period');
      container.appendChild(bar);

      // Animate bars in one by one (skipped when reduced motion is requested)
      if (!reduceMotion) {
        bar.style.opacity = '0';
        setTimeout(() => { bar.style.opacity = '1'; bar.style.transition = 'opacity 0.2s'; }, i * 50);
      }
    });
    sec.appendChild(container);
  }

  if (step.label === 'QFT distribution') {
    const data = step.data as { distribution: Array<{m:number; probability:number; peak:boolean}>; measured: number; Q: number; r: number };
    const sec = getVizSection(`qft-${vizAttempt}`, `QFT probability distribution  (classically simulated)  —  Q = ${data.Q},  r = ${data.r}`);
    const wrapper = document.createElement('div');
    wrapper.className = 'qft-bars-wrapper';
    // Focusable so keyboard users can scroll the chart (WCAG 2.1.1).
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('aria-label', `Bar chart of the QFT measurement probability distribution. It peaks at multiples of Q/r ≈ ${Math.round(data.Q / data.r)}. The sampled measurement was m = ${data.measured}.`);
    const barsDiv = document.createElement('div');
    barsDiv.className = 'qft-bars';
    const maxP = Math.max(...data.distribution.map(d => d.probability), 0.001);
    data.distribution.forEach((item, i) => {
      const bar = document.createElement('div');
      bar.className = 'qft-bar';
      if (item.peak) bar.classList.add('qft-bar--peak');
      if (item.m === data.measured) bar.classList.add('qft-bar--sampled');
      const h = Math.max(2, Math.round((item.probability / maxP) * 76));
      bar.style.height = h + 'px';
      bar.style.width = '8px';
      bar.title = `m=${item.m}  p=${item.probability.toFixed(4)}${item.peak ? ' (peak)' : ''}`;
      if (!reduceMotion) {
        bar.style.opacity = '0';
        setTimeout(() => { bar.style.opacity = '1'; bar.style.transition = 'opacity 0.15s'; }, i * 30);
      }
      barsDiv.appendChild(bar);
    });
    wrapper.appendChild(barsDiv);
    sec.appendChild(wrapper);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.75rem;color:var(--text-dim);margin-top:0.4rem';
    note.textContent = `Sampled measurement: m = ${data.measured}  (magenta = peaks at k·Q/r,  green = sampled point)`;
    sec.appendChild(note);

    // Phasor wheels: make the interference that CREATES those peaks visible.
    renderPhasors(sec, data.r, data.Q, data.measured);
  }

  if (step.label === 'Continued fractions') {
    const data = step.data as { convergents: Array<{num:bigint; den:bigint}>; chosenR: bigint | null; m: number|bigint; Q: bigint };
    const a = extractA();
    const sec = getVizSection(`cf-${vizAttempt}`, `Continued Fraction Extraction  —  phase ${data.m} / ${data.Q}`);

    // Plain-language purpose + the visual bridge from the sampled QFT point.
    //
    // The last clause is conditional on `chosenR`, because this same panel is
    // rendered for the attempt that FAILS: when six measurements in a row land
    // on a peak k sharing a factor with r, no convergent denominator satisfies
    // a^d ≡ 1, nothing is crowned and no row is highlighted. Promising a
    // highlight unconditionally described a table the reader is not looking at.
    const caption = document.createElement('p');
    caption.className = 'cf-caption';
    caption.innerHTML =
      `The measurement gave a noisy fraction <span class="cf-caption__sampled">m/Q = ${data.m}/${data.Q}</span> ` +
      `(the <strong>green sampled bar</strong> above). It is close to some clean <em>k/r</em>, but we don't yet know <em>r</em>. ` +
      `<strong>Continued fractions</strong> expand that decimal into its best simple-fraction approximations (convergents); ` +
      (data.chosenR !== null && data.chosenR !== undefined
        ? `the first denominator that passes <span class="cf-caption__sampled">a<sup>r</sup> ≡ 1 (mod N)</span> is the period <em>r</em> — highlighted below.`
        : `the period <em>r</em> would be the first denominator that passes <span class="cf-caption__sampled">a<sup>r</sup> ≡ 1 (mod N)</span> — but here <strong>none of them does</strong>, so no row is highlighted and this base is discarded.`);
    sec.appendChild(caption);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-scroll';
    tableWrap.setAttribute('tabindex', '0');
    tableWrap.setAttribute('role', 'region');
    tableWrap.setAttribute('aria-label', `Continued fraction convergents of ${data.m}/${data.Q}`);
    const table = document.createElement('table');
    table.className = 'convergents';
    table.innerHTML = '<caption class="sr-only">Continued fraction convergents and whether each denominator is the period</caption><thead><tr><th scope="col">Convergent</th><th scope="col">Fraction</th><th scope="col">Test: a^r ≡ 1 mod N?</th></tr></thead>';
    const tbody = document.createElement('tbody');
    let winnerFound = false;
    data.convergents.forEach((conv, i) => {
      const tr = document.createElement('tr');
      let testText = '—';
      let testClass = 'conv-fail';
      let isWinner = false;
      if (a !== null && conv.den >= 2n) {
        try {
          const check = modPow(a, conv.den, N);
          if (check === 1n) {
            testText = `✓  r = ${conv.den}`;
            testClass = 'conv-ok';
            if (!winnerFound) { isWinner = true; winnerFound = true; }
          } else { testText = `${a}^${conv.den} ≡ ${check} mod ${N}`; }
        } catch { testText = '—'; }
      }
      if (isWinner) tr.className = 'conv-winner';
      const flag = isWinner ? ' ← the period r' : '';
      tr.innerHTML = `<td>${i + 1}</td><td>${conv.num}/${conv.den}</td><td class="${testClass}">${testText}${flag}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    sec.appendChild(tableWrap);
  }
}

// ── Phasor wheels — the visible QFT interference mechanism ───────────────
// For the comb of inputs x = 0, r, 2r, 3r, … (all sharing one f(x) value),
// the QFT assigns each state a phase φ = 2π·m·x/Q — a rotating "clock hand".
// The measured probability at frequency m is |Σ e^{iφ}|². This panel draws
// those hands for the first few comb entries at a chosen m, then their vector
// sum, so the learner SEES them align at m = k·Q/r and cancel elsewhere.
// (Classically simulated — same |Σ e^{iφ}|² the qft.ts distribution plots.)
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderPhasors(sec: HTMLElement, r: number, Q: number, measured: number): void {
  if (r < 2 || Q < 2) return;
  const NHANDS = Math.min(6, r); // comb entries shown: x = 0, r, 2r, … up to 6
  const kNear = Math.round((measured * r) / Q); // nearest peak index k to the sample
  const peakM = Math.round((kNear * Q) / r);    // an exact on-peak frequency k·Q/r
  const offM = Math.max(1, peakM - Math.max(1, Math.round(Q / (r * 4)))); // an off-peak frequency

  const block = document.createElement('div');
  block.className = 'phasor-block';

  const title = document.createElement('div');
  title.className = 'viz-section__title';
  title.textContent = 'Phasor wheels — why the peaks form (classically simulated)';
  block.appendChild(title);

  // Frequency selector: the sampled m, an exact on-peak m, and an off-peak m.
  const controls = document.createElement('div');
  controls.className = 'phasor-controls';
  const lbl = document.createElement('span');
  lbl.className = 'phasor-freq-label';
  lbl.textContent = 'Set frequency m:';
  controls.appendChild(lbl);

  const wheelsHost = document.createElement('div');
  wheelsHost.className = 'phasor-wheels';

  const explain = document.createElement('p');
  explain.className = 'phasor-explain';

  type Choice = { m: number; label: string; peak: boolean };
  const choices: Choice[] = [];
  const seen = new Set<number>();
  const push = (c: Choice) => { if (!seen.has(c.m)) { seen.add(c.m); choices.push(c); } };
  push({ m: peakM, label: `on-peak  m = ${peakM} = ${kNear}·Q/r`, peak: true });
  push({ m: measured, label: `sampled  m = ${measured}`, peak: (measured * r) % Q === 0 });
  push({ m: offM, label: `off-peak  m = ${offM}`, peak: false });

  function draw(m: number): void {
    wheelsHost.innerHTML = '';
    // Resultant accumulation
    let sx = 0, sy = 0;
    const R = 22, cx = 26, cy = 26;
    for (let j = 0; j < NHANDS; j++) {
      const x = j * r;                       // comb entry
      const phi = 2 * Math.PI * ((m * x) % Q) / Q;
      const hx = cx + R * Math.cos(phi);
      const hy = cy - R * Math.sin(phi);
      sx += Math.cos(phi);
      sy += Math.sin(phi);

      const wheel = document.createElement('div');
      wheel.className = 'phasor-wheel';
      const svg = svgEl('svg', { width: '52', height: '52', viewBox: '0 0 52 52',
        role: 'img', 'aria-label': `Phasor for input x = ${x}: clock hand at ${Math.round((phi * 180) / Math.PI)} degrees.` });
      svg.appendChild(svgEl('circle', { class: 'phasor-circle', cx: `${cx}`, cy: `${cy}`, r: `${R}` }));
      svg.appendChild(svgEl('line', { class: 'phasor-hand', x1: `${cx}`, y1: `${cy}`, x2: `${hx.toFixed(1)}`, y2: `${hy.toFixed(1)}` }));
      wheel.appendChild(svg);
      const cap = document.createElement('div');
      cap.className = 'phasor-wheel__cap';
      cap.textContent = `x=${x}`;
      wheel.appendChild(cap);
      wheelsHost.appendChild(wheel);
    }

    // Resultant sum vector
    const mag = Math.sqrt(sx * sx + sy * sy);
    const aligned = mag > NHANDS * 0.8; // hands roughly all pointing the same way
    const sumBox = document.createElement('div');
    sumBox.className = 'phasor-sum';
    const R2 = 22, cx2 = 26, cy2 = 26;
    const scale = R2 / NHANDS;
    const ex = cx2 + sx * scale;
    const ey = cy2 - sy * scale;
    const svg2 = svgEl('svg', { width: '52', height: '52', viewBox: '0 0 52 52',
      role: 'img', 'aria-label': `Vector sum of the ${NHANDS} hands: magnitude ${mag.toFixed(1)} of a possible ${NHANDS}. ${aligned ? 'They add up.' : 'They mostly cancel.'}` });
    svg2.appendChild(svgEl('circle', { class: 'phasor-circle', cx: `${cx2}`, cy: `${cy2}`, r: `${R2}` }));
    svg2.appendChild(svgEl('line', {
      class: `phasor-sum__vec ${aligned ? 'phasor-sum__vec--add' : 'phasor-sum__vec--cancel'}`,
      x1: `${cx2}`, y1: `${cy2}`, x2: `${ex.toFixed(1)}`, y2: `${ey.toFixed(1)}` }));
    sumBox.appendChild(svg2);
    const sumLabel = document.createElement('div');
    sumLabel.className = `phasor-sum__label ${aligned ? 'phasor-sum__label--add' : 'phasor-sum__label--cancel'}`;
    sumLabel.textContent = aligned ? `Σ = ${mag.toFixed(1)} ✓ add` : `Σ = ${mag.toFixed(1)} ✗ cancel`;
    sumBox.appendChild(sumLabel);
    wheelsHost.appendChild(sumBox);

    explain.innerHTML = aligned
      ? `At <strong>m = ${m}</strong>, every hand points nearly the same way — they <span class="aha__phase--add">add</span> to a long resultant (Σ ≈ ${mag.toFixed(1)} of ${NHANDS}). This is a <strong>peak</strong>: a likely measurement.`
      : `At <strong>m = ${m}</strong>, the hands fan around the circle and <span class="aha__phase--cancel">cancel</span> (Σ ≈ ${mag.toFixed(1)} of ${NHANDS}). Near-zero probability — an unlikely measurement.`;
  }

  choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phasor-freq-btn' + (c.peak ? ' phasor-freq-btn--peak' : '');
    btn.textContent = c.label;
    btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      controls.querySelectorAll('.phasor-freq-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      draw(c.m);
    });
    controls.appendChild(btn);
  });

  block.appendChild(controls);
  block.appendChild(wheelsHost);
  block.appendChild(explain);
  sec.appendChild(block);
  draw(choices[0]!.m); // start on the on-peak frequency
}

// ── 'Why period-finding factors N' — live numbers from this run ──────────
// Substitutes the actual a, r, a^(r/2), and both gcds into explainer #1 so the
// learner sees the abstract chain instantiated by their own factorisation.
function populateAhaPeriod(step: ShorStep, N: bigint): void {
  const d = step.data as { a: bigint; r: bigint; half: bigint; p: bigint; q: bigint };
  const halfExp = d.r / 2n;
  const minus = d.half - 1n;
  const plus = d.half + 1n;
  ahaPeriodLive.dataset['empty'] = 'false';
  ahaPeriodLive.innerHTML =
    `<span class="aha__live-label">This run:</span>` +
    `<span class="aha__live-text">` +
    `base <code>a = ${d.a}</code>, period <code>r = ${d.r}</code> (even ✓). ` +
    `Then <code>a<sup>r/2</sup> = ${d.a}<sup>${halfExp}</sup> mod ${N} = ${d.half}</code>, so ` +
    `<code>gcd(${d.half}−1, ${N}) = gcd(${minus}, ${N}) = <span class="aha__live-hit">${d.p}</span></code> and ` +
    `<code>gcd(${d.half}+1, ${N}) = gcd(${plus}, ${N}) = <span class="aha__live-hit">${d.q}</span></code>. ` +
    `Check: <code>${d.p} × ${d.q} = ${N}</code> ✓` +
    `</span>`;
}

function resetAhaPeriod(): void {
  ahaPeriodLive.dataset['empty'] = 'true';
  ahaPeriodLive.innerHTML =
    `<span class="aha__live-label">This run:</span>` +
    `<span class="aha__live-text">run the algorithm and the exact numbers from your factorisation appear here.</span>`;
}

// ── Stage banner: a one-line 'what just happened / what's next' between the
// three teaching stages of a run, so the learner absorbs periodicity → QFT →
// recovery in order rather than all at once. Inserted into the step log.
//
// `mark` exists because stage 3 can fail. The banner was emitted for every
// 'Continued fractions' step regardless of `step.success`, so an attempt whose
// own log entry read "The period was not recovered, so this base is discarded"
// was immediately followed by "✓ Stage 3 — recovered the period r". Two
// exhibits, same moment, opposite verdicts — and it is not rare: 53 of 720
// simulated runs hit that path.
function appendStageBanner(now: string, next: string, mark = '✓'): void {
  const b = document.createElement('div');
  b.className = 'stage-banner';
  b.setAttribute('role', 'note');
  b.innerHTML = `<span class="stage-banner__now">${mark} ${now}</span> — <span class="stage-banner__next">next: ${next}</span>`;
  stepLog.querySelector('.step-log__placeholder')?.remove();
  stepLog.appendChild(b);
  stepLog.scrollTop = stepLog.scrollHeight;
}

// ── Extract last chosen 'a' from steps ──────────────────────────────────
let lastA: bigint | null = null;
function extractA(): bigint | null { return lastA; }

// ── Main run ─────────────────────────────────────────────────────────────
const STEP_DELAY = 300;
function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function setError(msg: string): void {
  nError.textContent = msg;
  nError.hidden = msg === '';
  nInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

async function handleRun(): Promise<void> {
  if (isRunning) return; // ignore re-entrant triggers (Run, Enter, presets)
  // `Number`, not `parseInt`. `parseInt('15.5')` is 15, so the lab silently
  // factored a different integer from the one the field was showing while its
  // own error copy promised "a whole number". A number input keeps '15.5' in
  // `.value`, so this is reachable by typing.
  const raw = Number(nInput.value.trim());
  if (nInput.value.trim() === '' || !Number.isInteger(raw) || raw < 4 || raw > 9999) {
    setError('Please enter a whole number N between 4 and 9999.');
    nInput.focus();
    return;
  }
  setError('');
  const N = BigInt(raw);
  const myToken = ++runToken;
  isRunning = true;
  lastA = null;
  vizSections = {};
  vizAttempt = 0;
  resetAhaPeriod();
  resetCallout();
  stepLog.innerHTML = `<div style="color:var(--text-dim);margin-bottom:0.5rem">━━━ SHOR'S ALGORITHM: N = ${N} ━━━</div>`;
  vizPanel.innerHTML = '<p class="viz-panel__placeholder">Computing…</p>';
  runBtn.disabled = true;

  try {
    // Collect steps, then render with 300ms delay between each
    const collectedSteps: ShorStep[] = [];
    const result = await runShor(N, (step: ShorStep) => {
      collectedSteps.push(step);
    });
    if (myToken !== runToken) return; // cancelled (e.g. Reset) during compute

    for (const step of collectedSteps) {
      if (myToken !== runToken) return; // cancelled mid-replay
      if (step.label === 'Random base' || step.label === 'Lucky GCD') {
        const data = step.data as { a?: bigint };
        if (data?.a !== undefined) lastA = data.a;
        if (step.label === 'Random base') vizAttempt++;
      }
      renderStep(step, N);
      await delay(STEP_DELAY);

      // Progressive pacing: after each teaching stage completes, drop a one-line
      // 'what just happened / what's next' banner and pause a beat before the
      // next stage's panel populates, so periodicity → QFT → recovery land in order.
      if (myToken !== runToken) return;
      if (step.label === 'Period table') {
        appendStageBanner(
          'Stage 1 — found the repeating pattern of f(x) = aˣ mod N',
          'Stage 2 — the QFT turns that period into a measurable frequency (watch the phasor wheels)'
        );
        await delay(STEP_DELAY);
      } else if (step.label === 'QFT distribution') {
        appendStageBanner(
          'Stage 2 — measured a frequency spike at a multiple of Q/r',
          'Stage 3 — continued fractions turn that noisy m/Q back into the clean period r'
        );
        await delay(STEP_DELAY);
      } else if (step.label === 'Continued fractions') {
        if (step.success) {
          appendStageBanner(
            'Stage 3 — recovered the period r',
            'the payoff — gcd(a^(r/2) ± 1, N) peels off the factors (see explainer 1 above)'
          );
        } else {
          appendStageBanner(
            'Stage 3 — no convergent denominator satisfied a^r ≡ 1, so the period was NOT recovered',
            'a fresh base a, and another order-finding attempt',
            '↺'
          );
        }
        await delay(STEP_DELAY);
      }
    }
    if (myToken !== runToken) return;

    // Result banner
    const banner = document.createElement('div');
    if (result.factors) {
      banner.className = 'result-banner';
      banner.textContent = `━━━ RESULT: ${N} = ${result.factors[0]} × ${result.factors[1]}  |  Attempts: ${result.attempts}  |  Time: ${Math.round(result.totalTime)}ms ━━━`;
      updateCallout(N, result.factors);
    } else if (result.note) {
      banner.className = 'result-banner result-banner--info';
      banner.textContent = `━━━ ${result.note} ━━━`;
    } else {
      banner.className = 'result-banner result-banner--fail';
      banner.textContent = `━━━ No factors found after ${result.attempts} attempts ━━━`;
    }
    stepLog.appendChild(banner);
    stepLog.scrollTop = stepLog.scrollHeight;

    // If N was resolved classically (even / perfect power / prime / too small),
    // no QFT visualization is produced — replace the "Computing…" placeholder.
    //
    // A Lucky GCD on the FIRST attempt lands here too, and it is not the same
    // claim: nothing about N was resolved classically in the structural sense —
    // a random base simply happened to share a factor with it, and re-running
    // takes the quantum path. Saying "for this input" of a run-level accident
    // was wrong for a third of N = 15 runs, the lab's own default.
    if (Object.keys(vizSections).length === 0) {
      const lucky = collectedSteps.some((s) => s.label === 'Lucky GCD');
      vizPanel.innerHTML = lucky
        ? '<p class="viz-panel__placeholder">This run drew a base a that already shared a factor with N, so gcd(a, N) handed over a factor before any order-finding ran — there is no QFT visualization for <em>this run</em>. Press Run again for the quantum path.</p>'
        : '<p class="viz-panel__placeholder">N was resolved classically — no quantum order-finding was needed, so there is no QFT visualization for this input.</p>';
    }
  } finally {
    // Only clear state if this run is still the current one; a newer run or a
    // Reset (which bumped runToken) owns the button/flag now.
    if (myToken === runToken) {
      runBtn.disabled = false;
      isRunning = false;
    }
  }
}

const CALLOUT_LINKS = `
    <p class="live-callout__links">
      → <a href="https://systemslibrarian.github.io/crypto-lab-kyber-vault/" target="_blank" rel="noopener">crypto-lab-kyber-vault</a> — post-quantum replacement<br>
      → <a href="https://systemslibrarian.github.io/crypto-lab-bb84/" target="_blank" rel="noopener">crypto-lab-bb84</a> — physics-based alternative
    </p>`;

/**
 * Return the RSA-impact call-out to its shipped copy.
 *
 * `updateCallout` overwrites this panel with "This demo factored N = 143 →
 * 11 × 13", and nothing ever took it back. Reset restored the step log, the
 * viz panel and the live explainer to their placeholders while this panel kept
 * asserting a factorisation the page no longer showed anywhere; and a following
 * run of a prime (or of a different N that failed) left it naming the PREVIOUS
 * run's N. So it is cleared at the start of every run and on Reset.
 */
function resetCallout(): void {
  liveCallout.innerHTML = `
    <p>Run the algorithm above to see a live demo.</p>${CALLOUT_LINKS}`;
}

function updateCallout(N: bigint, factors: [bigint, bigint]): void {
  liveCallout.innerHTML = `
    <p>This demo factored <strong>N = ${N}</strong> → <strong>${factors[0]} × ${factors[1]}</strong> using Shor's algorithm.</p>
    <p>Real RSA-2048: N has <strong>617 decimal digits</strong>. Same algorithm, same structure — just needs ~4,100 logical qubits.</p>${CALLOUT_LINKS}`;
}

// ── Reset ────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  runToken++;          // cancel any in-flight run's replay loop
  isRunning = false;
  stepLog.innerHTML = '<p class="step-log__placeholder">Enter N and press ▶ Run Shor\'s Algorithm to begin.</p>';
  vizPanel.innerHTML = '<p class="viz-panel__placeholder">Visualization will appear here after running the algorithm.</p>';
  vizSections = {};
  vizAttempt = 0;
  lastA = null;
  resetAhaPeriod();
  resetCallout();
  runBtn.disabled = false;
  setError('');
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
});

nInput.addEventListener('input', () => setError(''));
nInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleRun(); });
runBtn.addEventListener('click', handleRun);

