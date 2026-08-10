import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText, formatNonTextFailures, type NonTextFailure } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this file
 *     replaces did drive one quantum run — better than most in this fleet —
 *     but then called `expandAll`, which forced every `<details>` open and
 *     stripped `[hidden]` off everything. `#n-error` is `hidden` until the
 *     input is actually invalid, so stripping the attribute scanned a
 *     `role="alert"` no visitor had triggered, while the real invalid-input
 *     state was never visited. It also injected
 *     `animation-duration: 0s / transition-duration: 0s`, so the suite was
 *     structurally incapable of observing a transition or theme-swap defect.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing, and this page builds the step log, the period/QFT bar charts,
 *     the phasor wheels and the convergents table entry by entry after a run.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab's
 * bar charts are the shape to watch: `renderStep` sets an inline
 * `opacity: 0` on each bar and schedules a timeout to bring it back, guarded
 * by a `prefers-reduced-motion` check read once at load.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Applying it before navigation also matters
 * for correctness here and not only for the scan: `main.ts` reads
 * `matchMedia('(prefers-reduced-motion: reduce)')` once at module scope, so a
 * preference applied after load would be missed by the bar renderers.
 *
 * The theme is seeded in `localStorage` rather than reached by clicking the
 * toggle, so the page boots in the theme under test instead of transitioning
 * into it.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  await expect(page.locator('#run-btn')).toBeVisible();
  await expect(page.locator('#step-log')).not.toBeEmpty();
  await expect(page.locator('.resource-table tbody tr')).toHaveCount(5);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it prints a four-column resource table, a three-column
 * convergents table, a long monospace step log and a QFT chart whose width
 * grows with Q.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide table inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const widest = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .filter((x) => !clipped(x.el))
      .sort((a, b) => b.r.right - a.r.right)[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node. Both were being found by hand-sampling screenshot pixels, which does
 * not regress-test.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate, and this sweep has spent its whole length deleting checks
 * that could not fail. So it ratchets instead: anything NOT in the baseline
 * fails, anything in the baseline that got WORSE fails, and anything in the
 * baseline that has been FIXED fails until its entry is deleted. That last rule
 * is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectNoNewNonTextFailures(page, label);
  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/**
 * Run the algorithm until a run actually takes the quantum path.
 *
 * Shor is randomized: a run can short-circuit on a "Lucky GCD" (the base shares
 * a factor with N) and emit no order-finding visualization at all. That is
 * correct behaviour, not a bug — so retry until the quantum path really ran,
 * and fail loudly rather than silently scanning a page where it never did.
 *
 * "Really ran" needs BOTH conditions below, and requiring only the first is a
 * live trap: an early attempt can render its charts and then a LATER attempt
 * finish on a Lucky GCD, so `.viz-section` exists while the factorisation that
 * produced the banner never used a period at all — and `#aha-period-live`,
 * the panel that instantiates the explainer with this run's own numbers, is
 * still empty. N = 143 (11 x 13) is used because it has lower Lucky-GCD odds
 * than 15.
 */
async function runQuantumPath(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#run-btn').click();
    await expect(page.locator('.result-banner')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 60_000 });
    const charted = await page.locator('#viz-panel .viz-section').first().isVisible();
    const explained =
      (await page.locator('#aha-period-live').getAttribute('data-empty')) === 'false';
    if (charted && explained) return;
    await page.locator('#reset-btn').click();
  }
  throw new Error('twenty runs of N=143 never finished through the quantum path');
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Every control on the page is reached: both theme toggles are covered by
 * booting each theme from `localStorage`, `#n-input` is exercised through its
 * valid, invalid and classically-resolvable branches, one `.preset-btn` runs a
 * full factorisation from the preset row, `#run-btn` and `#reset-btn` are both
 * clicked, both `.aha` disclosures are closed and reopened, `.ecc-detail` is
 * opened, and every `.phasor-freq-btn` is visited so BOTH verdict branches
 * ("add" and "cancel") are scanned rather than only the on-peak default.
 *
 * Two states are deliberately not driven, and it is worth saying why rather
 * than leaving a silent gap:
 *  - `.result-banner--fail` ("No factors found") needs every one of the
 *    algorithm's attempts to fail, which a correct implementation makes
 *    vanishingly unlikely; there is no deterministic route to it.
 *  - the shared header's `.cl-topbar` links open external sites.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint`);

  // The skip link is parked off-screen until focused; the focused rendering is
  // the state a keyboard visitor actually sees.
  await page.locator('.cl-skip-link').focus();
  await scan(page, `${theme} / skip link focused`);
  await page.locator('#n-input').focus();

  // Invalid input: `#n-error` is `hidden` until this happens, and `#n-input`
  // gains `aria-invalid`. The old gate stripped `[hidden]` instead of getting
  // here, which scanned an alert no visitor had triggered.
  await page.locator('#n-input').fill('2');
  await page.locator('#run-btn').click();
  await expect(page.locator('#n-error')).toBeVisible();
  await scan(page, `${theme} / invalid input`);

  // Classically resolvable N: a real result banner, but the viz panel renders
  // its "no quantum order-finding was needed" placeholder instead of a chart.
  await page.locator('#n-input').fill('16');
  await page.locator('#run-btn').click();
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.viz-panel__placeholder')).toBeVisible();
  await scan(page, `${theme} / classical resolution`);

  // A prime: the informational banner variant, a third distinct verdict style.
  await page.locator('#reset-btn').click();
  await page.locator('#n-input').fill('97');
  await page.locator('#run-btn').click();
  await expect(page.locator('.result-banner--info')).toBeVisible({ timeout: 60_000 });
  await scan(page, `${theme} / prime N`);

  // The quantum path: step log, period bars, QFT distribution, phasor wheels
  // and the convergents table, all rendered after the run.
  await page.locator('#reset-btn').click();
  await page.locator('#n-input').fill('143');
  await runQuantumPath(page);
  // A run may need several attempts, each of which renders its own convergents
  // table, so this is deliberately `.first()` rather than a strict match.
  await expect(page.locator('table.convergents').first()).toBeVisible();
  await scan(page, `${theme} / quantum run`);

  // The phasor exhibit has two verdicts — hands that add and hands that
  // cancel — and only one of them is on screen at a time. Visit every
  // frequency button so both are scanned.
  const freqButtons = page.locator('.phasor-freq-btn');
  const freqCount = await freqButtons.count();
  expect(freqCount, 'the phasor exhibit must offer its frequency choices').toBeGreaterThan(1);
  for (let i = 0; i < freqCount; i++) {
    const label = (await freqButtons.nth(i).textContent())?.trim();
    await freqButtons.nth(i).click();
    await expect(freqButtons.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await scan(page, `${theme} / phasor frequency ${label}`);
  }

  // The one disclosure that ships closed.
  await page.locator('.ecc-detail__summary').click();
  await expect(page.locator('.ecc-detail')).toHaveAttribute('open', '');
  await scan(page, `${theme} / ECC explainer open`);

  // ...and the two that ship open, collapsed — a state a visitor reaches by
  // clicking, and one the old gate's `expandAll` made unreachable.
  await page.locator('#aha-period .aha__summary').click();
  await page.locator('#aha-qft .aha__summary').click();
  await expect(page.locator('#aha-period')).not.toHaveAttribute('open', '');
  await scan(page, `${theme} / aha explainers collapsed`);
  await page.locator('#aha-period .aha__summary').click();
  await page.locator('#aha-qft .aha__summary').click();

  // A run started from the preset row rather than the text field, then Reset,
  // which returns both panels to their placeholder copy.
  await page.locator('.preset-btn[data-n="21"]').click();
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 60_000 });
  await scan(page, `${theme} / preset run`);

  await page.locator('#reset-btn').click();
  await expect(page.locator('.step-log__placeholder')).toBeVisible();
  await scan(page, `${theme} / reset`);
}
