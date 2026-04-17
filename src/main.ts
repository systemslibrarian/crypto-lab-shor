import './style.css';
import { runShor, type ShorStep } from './shor.ts';
import { modPow } from './arithmetic.ts';

// ── Theme toggle ─────────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
function applyTheme(t: string) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.textContent = t === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('cv-theme', t);
}
themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});
applyTheme(localStorage.getItem('cv-theme') ?? 'dark');

// ── DOM refs ─────────────────────────────────────────────────────────────
const nInput   = document.getElementById('n-input')   as HTMLInputElement;
const runBtn   = document.getElementById('run-btn')   as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const stepLog  = document.getElementById('step-log')  as HTMLDivElement;
const vizPanel = document.getElementById('viz-panel') as HTMLDivElement;
const liveCallout = document.getElementById('live-callout') as HTMLDivElement;

// ── Preset buttons ───────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
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
function renderStep(step: ShorStep): void {
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
  renderViz(step);
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

function renderViz(step: ShorStep): void {
  if (step.label === 'Period table') {
    const data = step.data as { table: Array<{x:number; fx:number}>; period: number; a: number; N: number };
    const sec = getVizSection('period', `f(x) = ${data.a}^x mod ${data.N}  —  period r = ${data.period}`);
    const container = document.createElement('div');
    container.className = 'period-bars';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', `Period table for f(x) = ${data.a}^x mod ${data.N}. Period r = ${data.period}`);
    const maxFx = Math.max(...data.table.map(d => d.fx), 1);
    data.table.forEach((row, i) => {
      const bar = document.createElement('div');
      bar.className = 'period-bar';
      const heightPct = Math.max(4, Math.round((row.fx / maxFx) * 100));
      bar.style.height = heightPct + '%';
      bar.setAttribute('tabindex', '0');
      bar.setAttribute('aria-label', `x=${row.x}, f(x)=${row.fx}`);
      bar.title = `x=${row.x}  f(x)=${row.fx}`;
      if (row.fx === 1 && i > 0) bar.classList.add('period-bar--period');
      container.appendChild(bar);

      // Animate bars in one by one
      bar.style.opacity = '0';
      setTimeout(() => { bar.style.opacity = '1'; bar.style.transition = 'opacity 0.2s'; }, i * 50);
    });
    sec.appendChild(container);
  }

  if (step.label === 'QFT distribution') {
    const data = step.data as { distribution: Array<{m:number; probability:number; peak:boolean}>; measured: number; Q: number; r: number };
    const sec = getVizSection('qft', `QFT probability distribution  (classically simulated)  —  Q = ${data.Q},  r = ${data.r}`);
    const wrapper = document.createElement('div');
    wrapper.className = 'qft-bars-wrapper';
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('aria-label', `QFT probability distribution. Peaks at multiples of Q/r = ${Math.round(data.Q / data.r)}. Sampled m = ${data.measured}.`);
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
      bar.style.opacity = '0';
      setTimeout(() => { bar.style.opacity = '1'; bar.style.transition = 'opacity 0.15s'; }, i * 30);
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
    const N = BigInt((document.getElementById('n-input') as HTMLInputElement).value);
    const a = extractA();
    const sec = getVizSection('cf', `Continued Fraction Extraction  —  phase ${data.m} / ${data.Q}`);
    const table = document.createElement('table');
    table.className = 'convergents';
    table.innerHTML = '<thead><tr><th>Convergent</th><th>Fraction</th><th>Test: a^r ≡ 1 mod N?</th></tr></thead>';
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
    sec.appendChild(table);
  }
}

// ── Extract last chosen 'a' from steps ──────────────────────────────────
let lastA: bigint | null = null;
function extractA(): bigint | null { return lastA; }

// ── Main run ─────────────────────────────────────────────────────────────
async function handleRun(): Promise<void> {
  const raw = parseInt(nInput.value, 10);
  if (isNaN(raw) || raw < 4 || raw > 9999) {
    alert('Please enter N between 4 and 9999.');
    return;
  }
  const N = BigInt(raw);
  lastA = null;
  vizSections = {};
  stepLog.innerHTML = `<div style="color:var(--text-dim);margin-bottom:0.5rem">━━━ SHOR'S ALGORITHM: N = ${N} ━━━</div>`;
  vizPanel.innerHTML = '<p class="viz-panel__placeholder">Computing…</p>';
  runBtn.disabled = true;

  const result = await runShor(N, (step: ShorStep) => {
    // Capture 'a' from random base step
    if (step.label === 'Random base' || step.label === 'Lucky GCD') {
      const data = step.data as { a?: bigint };
      if (data?.a !== undefined) lastA = data.a;
    }
    renderStep(step);
  });

  // Result banner
  const banner = document.createElement('div');
  if (result.factors) {
    banner.className = 'result-banner';
    banner.textContent = `━━━ RESULT: ${N} = ${result.factors[0]} × ${result.factors[1]}  |  Attempts: ${result.attempts}  |  Time: ${Math.round(result.totalTime)}ms ━━━`;
    updateCallout(N, result.factors);
  } else {
    banner.className = 'result-banner result-banner--fail';
    banner.textContent = `━━━ No factors found after ${result.attempts} attempts ━━━`;
  }
  stepLog.appendChild(banner);
  stepLog.scrollTop = stepLog.scrollHeight;
  runBtn.disabled = false;
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
  stepLog.innerHTML = '<p class="step-log__placeholder">Enter N and press ▶ Run Shor\'s Algorithm to begin.</p>';
  vizPanel.innerHTML = '<p class="viz-panel__placeholder">Visualization will appear here after running the algorithm.</p>';
  vizSections = {};
  lastA = null;
  runBtn.disabled = false;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
});

runBtn.addEventListener('click', handleRun);

