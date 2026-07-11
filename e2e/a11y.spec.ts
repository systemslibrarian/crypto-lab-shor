import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Strict WCAG regression gate for the Shor's Algorithm demo.
 *
 * The page is server-rendered HTML with a live demo driven by main.ts. Running
 * the algorithm injects the step log, the period/QFT bar charts, and the
 * continued-fraction table (all dynamically created). So we DRIVE the demo
 * (Run on a semiprime that requires quantum order-finding, e.g. N=15), wait for
 * the visualization + result banner, open every <details>, neutralize motion,
 * then scan — in both themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Neutralize animation/transition/opacity so mid-flight states (bar fade-in,
// the pulsing sampled-QFT bar) can't hide text/fills from the contrast checker.
async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      opacity:1!important;scroll-behavior:auto!important;
    }`,
  });
}

async function expandAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) (d as HTMLDetailsElement).open = true;
    for (const el of document.querySelectorAll<HTMLElement>('[hidden]')) el.removeAttribute('hidden');
  });
}

// Run the algorithm on N=15 (needs real order-finding → produces the period
// table, QFT distribution, and continued-fraction table). Wait for the async
// step replay + result banner to finish so every injected region is in the DOM.
async function driveDemo(page: Page): Promise<void> {
  await page.locator('#n-input').fill('15');
  await page.locator('#run-btn').click();
  // Result banner appears once the run completes.
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 30_000 });
  // Order-finding visualizations should have rendered.
  await expect(page.locator('#viz-panel .viz-section').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#run-btn')).toBeEnabled({ timeout: 30_000 });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#cl-theme-toggle')).toBeVisible();
  await expect(page.locator('#run-btn')).toBeVisible();
  await killMotion(page);
});

test('no WCAG A/AA violations in dark theme (demo driven)', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await driveDemo(page);
  await killMotion(page);
  await expandAll(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme (demo driven)', async ({ page }) => {
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await driveDemo(page);
  await killMotion(page);
  await expandAll(page);
  await scan(page);
});
