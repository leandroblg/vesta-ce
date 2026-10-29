import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.1 A/AA scan; fails with the list of violations (SC-009, FR-044, FR-045). */
/** `exclude`: selectors left out of the scan, for example colors the user chose (005 FR-041). */
export async function expectNoA11yViolations(page: Page, label: string, exclude: string[] = []): Promise<void> {
  // Legacy mode runs in the current page; the default opens a new page, which Electron does not support.
  let builder = new AxeBuilder({ page });
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).setLegacyMode(true).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} — ${n.failureSummary ?? ""}`),
  }));
  expect(summary, `axe violations: ${label}`).toEqual([]);
}
