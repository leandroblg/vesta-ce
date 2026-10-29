/** 014 FR-006b, FR-006c: the card icons take the colors the contrast test measures, in every palette and mode (T008). */
import { expect, test, type Locator } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { search } from "./fixtures/search";
import { seedTasks, staleTask, task } from "./fixtures/seed";

const PALETTES = ["hearth", "system", "ubuntu", "minimal"] as const;

/** The computed color of each selector in the card, the resolved tokens, and a hovered button's background. */
function colors(card: Locator) {
  return card.evaluate((li) => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    document.body.append(probe);
    const tok = (n: string) => {
      probe.style.color = root.getPropertyValue(n);
      return getComputedStyle(probe).color;
    };
    const tint = (() => {
      probe.style.backgroundColor = `color-mix(in srgb, ${root.getPropertyValue("--accent-fg")} 18%, transparent)`;
      return getComputedStyle(probe).backgroundColor;
    })();
    const c = (sel: string) => getComputedStyle(li.querySelector(sel) as Element).color;
    const out = {
      act: c(".act:not(.resched)"),
      resched: c(".act.resched"),
      grip: c(".grip"),
      muted: tok("--muted"),
      stale: tok("--stale"),
      accentFg: tok("--accent-fg"),
      tint,
    };
    probe.remove();
    return out;
  });
}

for (const palette of PALETTES) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`014 FR-006b FR-006c ${palette} ${colorScheme}: icons in --muted and --stale at rest, in --accent-fg on a selected card`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [staleTask({ titleMd: "Renew passport", position: 1 }), task({ titleMd: "Fix bike", position: 2 })]);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.emulateMedia({ colorScheme });
        await page.evaluate((p) => {
          document.documentElement.dataset["palette"] = p;
        }, palette);
        await tick(page);
        await waitBlinksDone(page);
        await page.mouse.move(0, 0);
        const card = taskCard(page, "Renew passport");
        // (a) at rest: Edit and the menu in --muted, Reschedule in --stale, the handle in --muted (no longer --fg-3).
        const rest = await colors(card);
        expect(rest.act).toBe(rest.muted);
        expect(rest.resched).toBe(rest.stale);
        expect(rest.grip).toBe(rest.muted);
        // (b) selected (the keyboard selection focuses the checkbox): every icon in the accent's text color.
        await card.locator('[data-ctl="cb"]').focus();
        const sel = await colors(card);
        expect(sel.act).toBe(sel.accentFg);
        expect(sel.resched).toBe(sel.accentFg);
        expect(sel.grip).toBe(sel.accentFg);
        // A hovered button on the selected card: the accent's text color at 18 %.
        await card.hover();
        await card.locator('[data-ctl="edit"]').hover();
        const bg = await card.locator('[data-ctl="edit"]').evaluate((b) => getComputedStyle(b).backgroundColor);
        expect(bg).toBe(sel.tint);
      } finally {
        await app.close();
      }
    });
  }
}

test("014 FR-006a the faded drag handle during a search is exempt and stays at 0.3", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Fix bike", position: 1 })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await search(page, "bike");
    const grip = taskCard(page, "Fix bike").locator(".grip");
    await expect(grip).toHaveClass(/off/);
    await taskCard(page, "Fix bike").hover();
    expect(await grip.evaluate((g) => getComputedStyle(g).opacity)).toBe("0.3");
  } finally {
    await app.close();
  }
});
