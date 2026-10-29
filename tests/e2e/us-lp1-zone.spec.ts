/** 014 User Story 1: the hover buttons in a reserved zone, never over the card's content (T006, T007). */
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { search } from "./fixtures/search";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";

const LONG = "Renew the passport before the summer trip and book the appointment at the consulate, then gather the two photos, the old passport, the proof of address and the application form signed in blue ink";
const ago = (ms: number) => Date.now() - ms;

type Box = { x: number; y: number; width: number; height: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

const remCard = (page: Page, text: string) =>
  page.locator("li[data-kind='rem']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });

const opacity = (l: Locator) => l.evaluate((el) => getComputedStyle(el).opacity);

async function launch(extra: { details?: string } = {}) {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Parent", position: 4, createdAt: ago(HOUR) });
  seedTasks(dataDir, [
    staleTask({ titleMd: "Short stale", position: 1 }),
    staleTask({ titleMd: LONG, position: 2 }),
    task({ titleMd: "Plain", position: 3, createdAt: ago(HOUR), detailsMd: extra.details ?? "" }),
    parent,
    staleTask({ titleMd: "Old sub", parentId: parent.id, position: 1 }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Call mom", position: 1 }), reminder({ textMd: "Water plants", position: 2 })]);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  await launched.page.mouse.move(0, 0);
  return launched;
}

/** The content boxes of a card that must never meet its zone. */
async function contentBoxes(card: Locator): Promise<Box[]> {
  const out: Box[] = [];
  for (const sel of [".title", ".stale-sub", ".search-excerpt"]) {
    const l = card.locator(sel).first();
    if ((await l.count()) > 0 && (await l.isVisible())) out.push(await box(l));
  }
  return out;
}

async function noOverlap(card: Locator) {
  const zone = await box(card.locator(".zone"));
  for (const b of await contentBoxes(card)) expect(meets(b, zone), JSON.stringify({ b, zone })).toBe(false);
}

async function lineRects(card: Locator): Promise<number> {
  return card.locator(".title").evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size;
  });
}

test.describe("014 US1 — the reserved zone", () => {
  test("FR-001 the zone is the same width on every card of a kind; content never enters it, at rest or on hover (a, b, j)", async () => {
    const { app, page } = await launch();
    try {
      const plainW = (await box(taskCard(page, "Plain").locator(".zone"))).width;
      expect((await box(taskCard(page, "Parent").locator(".zone"))).width).toBeCloseTo(plainW, 0);
      expect((await box(taskCard(page, "Short stale").locator(".zone"))).width).toBeGreaterThanOrEqual(plainW - 0.5);
      const rem1 = (await box(remCard(page, "Call mom").locator(".zone"))).width;
      expect((await box(remCard(page, "Water plants").locator(".zone"))).width).toBeCloseTo(rem1, 0);
      expect(rem1).toBeLessThan(plainW);
      const lefts = [await box(taskCard(page, "Plain").locator(".zone")), await box(taskCard(page, "Parent").locator(".zone"))].map((b) => b.x);
      expect(Math.abs((lefts[0] as number) - (lefts[1] as number))).toBeLessThanOrEqual(1);
      for (const card of [taskCard(page, "Short stale"), taskCard(page, LONG), taskCard(page, "Plain"), taskCard(page, "Parent"), remCard(page, "Call mom")]) {
        await noOverlap(card);
        await card.hover();
        await noOverlap(card);
        await page.mouse.move(0, 0);
      }
    } finally {
      await app.close();
    }
  });

  test("FR-002 FR-003 FR-004 the age sits on the title's last line, hides on hover in place, stays in the ARIA tree; nothing moves (c, d, f, k)", async () => {
    const { app, page } = await launch();
    try {
      const card = taskCard(page, LONG);
      const age = card.locator(".age");
      const actions = card.locator(".actions");
      expect(await opacity(age)).toBe("1");
      expect(await opacity(actions)).toBe("0");
      // (k) the age's bottom is on the title's last line.
      const lastBottom = await card.locator(".title").evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return Math.max(...[...r.getClientRects()].map((c) => c.bottom));
      });
      expect(Math.abs((await box(age)).y + (await box(age)).height - lastBottom)).toBeLessThanOrEqual(4);
      const height = (await box(card)).height;
      const lines = await lineRects(card);
      const ageBox = await box(age);
      await card.hover();
      await expect.poll(() => opacity(actions)).toBe("1");
      expect(await opacity(age)).toBe("0");
      expect((await box(card)).height).toBe(height);
      expect(await lineRects(card)).toBe(lines);
      expect(await box(age)).toEqual(ageBox);
      expect(await card.ariaSnapshot()).toContain("Stale");
      await page.mouse.move(0, 0);
      await expect.poll(() => opacity(age)).toBe("1");
    } finally {
      await app.close();
    }
  });

  test("FR-005 Q201 one rule for keyboard and pointer: the checkbox's focus keeps the age; Tab onto a button shows the buttons; the menu hides the age (e)", async () => {
    const { app, page } = await launch();
    try {
      const card = taskCard(page, "Short stale");
      await card.locator('[data-ctl="cb"]').focus();
      expect(await opacity(card.locator(".actions"))).toBe("0");
      expect(await opacity(card.locator(".age"))).toBe("1");
      await page.keyboard.press("Tab");
      await expect(card.locator(".actions button").first()).toBeFocused();
      await expect.poll(() => opacity(card.locator(".actions"))).toBe("1");
      expect(await opacity(card.locator(".age"))).toBe("0");
      await card.locator('[data-ctl="more"]').click();
      await page.mouse.move(0, 0);
      expect(await opacity(card.locator(".age"))).toBe("0");
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("FR-003 the inline editor stops before the zone; a click on the zone's empty space opens the details (g, h)", async () => {
    const { app, page } = await launch();
    try {
      const card = taskCard(page, "Plain");
      const zone = await box(card.locator(".zone"));
      await page.mouse.click(zone.x + 4, zone.y + zone.height / 2);
      await expect(page.getByTestId("details-panel")).toContainText("Plain");
      await page.keyboard.press("Escape");
      await card.locator(".title").dblclick();
      const edit = page.locator("li.row.editing");
      await expect(edit).toHaveCount(1);
      const ed = await box(edit.locator(".inline-edit").first());
      expect(ed.x + ed.width).toBeLessThanOrEqual((await box(edit.locator(".zone"))).x + 0.5);
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("FR-001 a search excerpt never meets the zone (i)", async () => {
    const { app, page } = await launch({ details: "remember the passport renewal and the consulate appointment" });
    try {
      await search(page, "consulate");
      const card = taskCard(page, "Plain");
      await expect(card.locator(".search-excerpt")).toBeVisible();
      await noOverlap(card);
      await card.hover();
      await noOverlap(card);
    } finally {
      await app.close();
    }
  });

  test("spec Edge Cases at 360 px: the title column stays at least as wide as the zone, and nothing meets it (l)", async () => {
    const { app, page } = await launch();
    try {
      await setSize(app, 360, 760);
      await page.waitForFunction(() => window.innerWidth <= 360);
      for (const card of [taskCard(page, "Short stale"), taskCard(page, LONG), taskCard(page, "Plain"), remCard(page, "Call mom")]) {
        expect((await box(card.locator(".title-wrap"))).width).toBeGreaterThanOrEqual((await box(card.locator(".zone"))).width);
        await noOverlap(card);
      }
    } finally {
      await app.close();
    }
  });

  test("FR-006e a selected card that blinks takes its unselected colors in the bright phase, the accent's text color in the dark one (T007)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Soon stale", position: 1, createdAt: ago(DAY - 2 * MIN) })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      const card = taskCard(page, "Soon stale");
      await card.locator('[data-ctl="cb"]').focus();
      await advanceClock(app, 5 * MIN);
      await tick(page);
      await expect(card).toHaveClass(/blink/);
      const at = (ms: number) =>
        card.evaluate((li, t) => {
          for (const a of li.getAnimations({ subtree: true })) {
            a.pause();
            a.currentTime = t;
          }
          const root = getComputedStyle(document.documentElement);
          const probe = document.createElement("div");
          document.body.append(probe);
          const tok = (n: string) => {
            probe.style.color = root.getPropertyValue(n);
            return getComputedStyle(probe).color;
          };
          const color = (sel: string) => getComputedStyle(li.querySelector(sel) as Element).color;
          const out = {
            title: color(".title"),
            age: color(".age"),
            act: color(".act:not(.resched)"),
            resched: color(".act.resched"),
            fg: tok("--fg"),
            staleFg: tok("--stale-fg"),
            muted: tok("--muted"),
            stale: tok("--stale"),
            accentFg: tok("--accent-fg"),
          };
          probe.remove();
          return out;
        }, ms);
      const bright = await at(200);
      expect(bright.title).toBe(bright.fg);
      expect(bright.age).toBe(bright.staleFg);
      expect(bright.act).toBe(bright.muted);
      expect(bright.resched).toBe(bright.stale);
      const dark = await at(600);
      for (const c of [dark.title, dark.age, dark.act, dark.resched]) expect(c).toBe(dark.accentFg);
    } finally {
      await app.close();
    }
  });

  test("FR-006e under reduced motion a blinking selected card keeps the accent's text color", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Soon stale", position: 1, createdAt: ago(DAY - 2 * MIN) })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await tick(page);
      const card = taskCard(page, "Soon stale");
      await card.locator('[data-ctl="cb"]').focus();
      await advanceClock(app, 5 * MIN);
      await tick(page);
      await expect(card).toHaveClass(/blink/);
      const c = await card.evaluate((li) => {
        const probe = document.createElement("div");
        document.body.append(probe);
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent-fg");
        const accentFg = getComputedStyle(probe).color;
        probe.remove();
        return { n: li.getAnimations({ subtree: true }).length, title: getComputedStyle(li.querySelector(".title") as Element).color, accentFg };
      });
      expect(c.n).toBe(0);
      expect(c.title).toBe(c.accentFg);
    } finally {
      await app.close();
    }
  });
});

async function setSize(app: ElectronApplication, w: number, h: number) {
  await app.evaluate(
    ({ BrowserWindow }, s) => {
      BrowserWindow.getAllWindows()[0]?.setSize(s.w, s.h);
    },
    { w, h },
  );
}
