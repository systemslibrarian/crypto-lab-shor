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
    const sec = getVizSection('period', `f(x) = ${data.a}^x mod ${data.N}  —  period r = ${data.period}`);
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
    const sec = getVizSection('qft', `QFT probability distribution  (classically simulated)  —  Q = ${data.Q},  r = ${data.r}`);
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
  }

  if (step.label === 'Continued fractions') {
    const data = step.data as { convergents: Array<{num:bigint; den:bigint}>; chosenR: bigint; m: number|bigint; Q: bigint };
    const a = extractA();
    const sec = getVizSection('cf', `Continued Fraction Extraction  —  phase ${data.m} / ${data.Q}`);
    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-scroll';
    tableWrap.setAttribute('tabindex', '0');
    tableWrap.setAttribute('role', 'region');
    tableWrap.setAttribute('aria-label', `Continued fraction convergents of ${data.m}/${data.Q}`);
    const table = document.createElement('table');
    table.className = 'convergents';
    table.innerHTML = '<caption class="sr-only">Continued fraction convergents and whether each denominator is the period</caption><thead><tr><th scope="col">Convergent</th><th scope="col">Fraction</th><th scope="col">Test: a^r ≡ 1 mod N?</th></tr></thead>';
    const tbody = document.createElement('tbody');
    data.convergents.forEach((conv, i) => {
      const tr = document.createElement('tr');
      let testText = '—';
      let testClass = 'conv-fail';
      if (a !== null && conv.den >= 2n) {
        try {
          const check = modPow(a, conv.den, N);
          if (check === 1n) { testText = `✓  r = ${conv.den}`; testClass = 'conv-ok'; }
          else { testText = `${a}^${conv.den} ≡ ${check} mod ${N}`; }
        } catch { testText = '—'; }
      }
      tr.innerHTML = `<td>${i + 1}</td><td>${conv.num}/${conv.den}</td><td class="${testClass}">${testText}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    sec.appendChild(tableWrap);
  }
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
  const raw = parseInt(nInput.value, 10);
  if (isNaN(raw) || raw < 4 || raw > 9999) {
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
      }
      renderStep(step, N);
      await delay(STEP_DELAY);
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
    if (Object.keys(vizSections).length === 0) {
      vizPanel.innerHTML =
        '<p class="viz-panel__placeholder">N was resolved classically — no quantum order-finding was needed, so there is no QFT visualization for this input.</p>';
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

function updateCallout(N: bigint, factors: [bigint, bigint]): void {
  liveCallout.innerHTML = `
    <p>This demo factored <strong>N = ${N}</strong> → <strong>${factors[0]} × ${factors[1]}</strong> using Shor's algorithm.</p>
    <p>Real RSA-2048: N has <strong>617 decimal digits</strong>. Same algorithm, same structure — just needs ~4,100 logical qubits.</p>
    <p class="live-callout__links">
      → <a href="https://systemslibrarian.github.io/crypto-lab-kyber-vault/" target="_blank" rel="noopener">crypto-lab-kyber-vault</a> — post-quantum replacement<br>
      → <a href="https://systemslibrarian.github.io/crypto-lab-bb84/" target="_blank" rel="noopener">crypto-lab-bb84</a> — physics-based alternative
    </p>`;
}

// ── Reset ────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  runToken++;          // cancel any in-flight run's replay loop
  isRunning = false;
  stepLog.innerHTML = '<p class="step-log__placeholder">Enter N and press ▶ Run Shor\'s Algorithm to begin.</p>';
  vizPanel.innerHTML = '<p class="viz-panel__placeholder">Visualization will appear here after running the algorithm.</p>';
  vizSections = {};
  lastA = null;
  runBtn.disabled = false;
  setError('');
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
});

nInput.addEventListener('input', () => setError(''));
nInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleRun(); });
runBtn.addEventListener('click', handleRun);

