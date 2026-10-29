// 013 US7 (spec scenarios 1–11; quickstart rows 15–19): the window as the identity draws it.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { search } from "./fixtures/search";
import { seedTasks, staleTask, task } from "./fixtures/seed";
import {
  IS_MAC,
  closeSettings,
  dialog,
  openSettings,
  setLanguage,
  showPane,
} from "./fixtures/settings";

/** The floating menu by its element: its name follows the language. */
const fmenu = (page: Page) => page.locator(".fmenu:not([hidden])");
const card = (page: Page, title: string) =>
  page
    .locator("li[data-kind='task']")
    .filter({
      has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }),
    });

async function launch() {
  const dataDir = freshDataDir();
  const now = Date.now();
  seedTasks(dataDir, [
    task({ titleMd: "Fix bike", position: 1 }),
    staleTask({ titleMd: "Renew passport", position: 2 }),
    task({ titleMd: "Paid rent", position: 3, doneAt: now - 1000 }),
    task({ titleMd: "Notes", detailsMd: "first\n\nsecond", position: 4 }),
  ]);
  return { ...(await launchVesta({ dataDir })), dataDir };
}

/** The row's background, text color and outline, and the theme's accent tokens. */
async function look(row: Locator) {
  return row.evaluate((li) => {
    const c = getComputedStyle(li);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    document.body.append(probe);
    probe.style.color = root.getPropertyValue("--accent");
    const accent = getComputedStyle(probe).color;
    probe.style.color = root.getPropertyValue("--accent-fg");
    const accentFg = getComputedStyle(probe).color;
    probe.remove();
    return {
      bg: c.backgroundColor,
      color: c.color,
      outline: c.outlineStyle,
      accent,
      accentFg,
      stripe: getComputedStyle(li, "::after").content,
    };
  });
}

test.describe("013 US7 — the window as the identity draws it", () => {
  test("US7-1 US7-2 US7-3 a selected card is a filled accent row with accent text and no outline; a stale one keeps its stripe; an edited one is not filled", async () => {
    const { app, page } = await launch();
    try {
      await card(page, "Fix bike").locator('[data-ctl="cb"]').focus();
      const sel = await look(card(page, "Fix bike"));
      expect(sel.bg).toBe(sel.accent);
      expect(sel.color).toBe(sel.accentFg);
      expect(sel.outline).toBe("none");
      await card(page, "Renew passport").locator('[data-ctl="cb"]').focus();
      const stale = await look(card(page, "Renew passport"));
      expect(stale.bg).toBe(stale.accent);
      expect(stale.stripe).not.toBe("none");
      await card(page, "Fix bike").locator(".title").dblclick();
      const editing = await look(page.locator("li.row.editing"));
      expect(editing.bg).not.toBe(editing.accent);
      await page.keyboard.press("Escape");
      // FR-034: the card open in the details panel is selected, but not while its title is edited inline.
      await card(page, "Notes").locator(".title").click();
      await expect(page.getByTestId("details-panel")).toBeVisible();
      expect((await look(card(page, "Notes"))).bg).toBe(sel.accent);
      await card(page, "Notes").locator(".title").dblclick();
      await expect(page.locator("li.row.editing")).toHaveCount(1);
      await expect(page.getByTestId("details-panel")).toBeVisible();
      expect(
        await page.locator("li.row.editing").getAttribute("data-selected"),
      ).not.toBeNull();
      const inPanel = await look(page.locator("li.row.editing"));
      expect(inPanel.bg).not.toBe(inPanel.accent);
      expect(inPanel.color).not.toBe(inPanel.accentFg);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator("li.arow[data-id]").first().focus();
      const entry = await look(page.locator("li.arow[data-id]").first());
      expect(entry.bg).toBe(entry.accent);
    } finally {
      await app.close();
    }
  });

  test("US7-4 the identity is the mark and the wordmark alone; US7-5 US7-6 the empty toolbar is the macOS drag region, its controls are not", async () => {
    const { app, page } = await launch();
    try {
      // 018 FR-001: the wordmark is "Vesta" with the CE superscript; screen readers hear " Community Edition".
      const brand = page.locator("header .brand");
      const word = () => brand.locator(".brand-name").evaluate((el) => el.firstChild?.textContent);
      expect(await word()).toBe("Vesta");
      await expect(brand.locator(".brand-name sup.ed")).toHaveText("CE");
      await page.getByRole("button", { name: /^Trash/ }).click();
      expect(await word()).toBe("Vesta");
      await expect(brand.locator(".brand-name sup.ed")).toHaveText("CE");
      await expect(page.locator("#view-h")).toBeVisible();
      await page.getByRole("button", { name: /^Trash/ }).click();
      test.skip(
        !IS_MAC,
        "the drag region is the macOS hidden-inset title bar (FR-033)",
      );
      const regions = await page.evaluate(() => {
        const bar = document.querySelector(".topbar") as HTMLElement;
        const brand = (
          document.querySelector(".brand") as HTMLElement
        ).getBoundingClientRect();
        const box = (
          document.querySelector(".search-box") as HTMLElement
        ).getBoundingClientRect();
        const nav = (
          document.querySelector(".nav") as HTMLElement
        ).getBoundingClientRect();
        const y = brand.top + brand.height / 2;
        const at = (x: number) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          let node: HTMLElement | null = el;
          while (node !== null && node !== bar.parentElement) {
            const r =
              getComputedStyle(node).getPropertyValue("-webkit-app-region");
            if (r === "drag" || r === "no-drag") return r;
            node = node.parentElement;
          }
          return "none";
        };
        // 014 FR-013: the new margin left of the identity and the 32 px right inset move the window too.
        const gaps = [
          (brand.right + box.left) / 2,
          (box.right + nav.left) / 2,
          bar.getBoundingClientRect().right - 4,
          brand.left - 10,
          nav.right + 16,
        ].map(at);
        const controls = Array.from(
          bar.querySelectorAll<HTMLElement>("button, input"),
        ).map((c) =>
          getComputedStyle(c).getPropertyValue("-webkit-app-region"),
        );
        return { gaps, controls };
      });
      expect(regions.gaps).toEqual(["drag", "drag", "drag", "drag", "drag"]);
      for (const r of regions.controls) expect(r).toBe("no-drag");
    } finally {
      await app.close();
    }
  });

  test("014 FR-010 to FR-012 (PRD Q194, Q195): the identity 20 px further right, the Archive and Trash buttons 32 px from the right edge and 8 px apart, the search box centered, nothing overlapping at 360 px (T023)", async () => {
    const { app, page } = await launch();
    try {
      const m = () =>
        page.evaluate(() => {
          const r = (sel: string) =>
            (
              document.querySelector(sel) as HTMLElement
            ).getBoundingClientRect();
          const buttons = Array.from(
            document.querySelectorAll<HTMLElement>(".nav .navbtn"),
          ).map((b) => b.getBoundingClientRect());
          return {
            brand: r(".brand"),
            box: r(".search-box"),
            nav: r(".nav"),
            buttons,
            width: window.innerWidth,
            mac: document.querySelector(".app.mac") !== null,
          };
        });
      const g = await m();
      expect(Math.abs(g.brand.left - (g.mac ? 104 : 32))).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(g.width - g.nav.right - 32)).toBeLessThanOrEqual(1);
      expect(g.buttons).toHaveLength(2);
      const [a, b] = g.buttons as [DOMRect, DOMRect];
      expect(Math.abs(b.left - a.right - 8)).toBeLessThanOrEqual(1);
      const mid = (g.brand.right + g.nav.left) / 2;
      expect(Math.abs(g.box.left + g.box.width / 2 - mid)).toBeLessThanOrEqual(
        1,
      );
      // The scope bar still spans the window.
      await search(page, "rent");
      const bar = await page.locator("#search-scope").boundingBox();
      expect(bar?.x).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs((bar?.x ?? 0) + (bar?.width ?? 0) - g.width),
      ).toBeLessThanOrEqual(1);
      await search(page, "");
      // FR-012 (PRD Q202): narrower windows give way in steps (spaces, wordmark, mark, search box minimum), never overlapping.
      expect(await page.locator("header.topbar").getAttribute("data-fit")).toBe(
        "0",
      );
      let previous = 0;
      for (const width of [900, 700, 560, 480, 420, 390, 360]) {
        await app.evaluate(({ BrowserWindow }, w) => {
          BrowserWindow.getAllWindows()[0]?.setSize(w, 760);
        }, width);
        await page.waitForFunction((w) => window.innerWidth <= w, width);
        await page.waitForTimeout(100);
        const level = Number(
          await page.locator("header.topbar").getAttribute("data-fit"),
        );
        expect(level, `${String(width)} px`).toBeGreaterThanOrEqual(previous);
        previous = level;
        const n = await page.evaluate(() => {
          const r = (sel: string) => {
            const el = document.querySelector<HTMLElement>(sel);
            return el !== null && el.offsetParent !== null
              ? el.getBoundingClientRect()
              : null;
          };
          return {
            brand: r(".brand"),
            name: r(".brand-name"),
            box: r(".search-box"),
            nav: r(".nav"),
          };
        });
        const meets = (p: DOMRect | null, q: DOMRect | null) =>
          p !== null &&
          q !== null &&
          p.left < q.right &&
          q.left < p.right &&
          p.top < q.bottom &&
          q.top < p.bottom;
        expect(meets(n.brand, n.box), `${String(width)} px`).toBe(false);
        expect(meets(n.box, n.nav), `${String(width)} px`).toBe(false);
        expect(
          n.name === null,
          `${String(width)} px: the wordmark goes at level 2`,
        ).toBe(level >= 2);
        expect(
          n.brand === null,
          `${String(width)} px: the mark goes at level 3`,
        ).toBe(level >= 3);
      }
    } finally {
      await app.close();
    }
  });

  test("US7-7 US7-8 the scope bar: Search in:, Active / Everything, Match case, Exact phrase, the count at the right; Everything searches the Archive", async () => {
    const { app, page } = await launch();
    try {
      await search(page, "rent", { includeArchiveTrash: true });
      const bar = page.locator("#search-scope");
      const texts = await bar
        .locator(":scope > *")
        .evaluateAll((els) => els.map((e) => e.textContent.trim()));
      expect(texts[0]).toBe("Search in:");
      expect(texts[1]).toBe("ActiveEverything");
      expect(texts.slice(2, 4)).toEqual(["Match case", "Exact phrase"]);
      await expect(
        bar.getByRole("radiogroup", { name: "Search in:" }),
      ).toBeVisible();
      await expect(
        bar.getByRole("radio", { name: "Everything" }),
      ).toHaveAttribute("aria-checked", "true");
      const right = await page.evaluate(() => {
        const bar = document.getElementById("search-scope") as HTMLElement;
        const count = bar.querySelector(".search-count") as HTMLElement;
        return (
          bar.getBoundingClientRect().right -
          count.getBoundingClientRect().right
        );
      });
      expect(right).toBeLessThan(24);
      await expect(page.locator("main")).toContainText("Paid rent");
      await search(page, "rent", { includeArchiveTrash: false });
      await expect(bar.getByRole("radio", { name: "Active" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } finally {
      await app.close();
    }
  });

  test("US7-9 Settings keeps its top edge on every pane, its bottom edge 10 % above the window's (015 FR-026, Q212); a long pane scrolls under a fixed toolbar", async () => {
    const { app, page } = await launch();
    try {
      await openSettings(page, "General");
      const top = (await dialog(page).boundingBox())?.y ?? 0;
      for (const pane of [
        "General",
        "Alerts",
        "Shortcuts",
        "Data",
        "Updates",
      ] as const) {
        await showPane(page, pane);
        const box = await dialog(page).boundingBox();
        const inner = await page.evaluate(() => window.innerHeight);
        expect(Math.abs((box?.y ?? 0) - top), pane).toBeLessThanOrEqual(1);
        expect((box?.y ?? 0) + (box?.height ?? 0), pane).toBeLessThanOrEqual(
          inner * 0.9 + 1,
        );
      }
      await closeSettings(page);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(900, 520);
      });
      await openSettings(page, "Shortcuts");
      const tabs = page.locator("dialog.settings-dialog[open] .set-tabs");
      const before = await tabs.boundingBox();
      const scrolled = await page
        .locator("dialog.settings-dialog[open] .modal-body")
        .evaluate((body) => {
          body.scrollTop = 400;
          return body.scrollTop > 0 && body.scrollHeight > body.clientHeight;
        });
      expect(scrolled).toBe(true);
      expect((await tabs.boundingBox())?.y).toBe(before?.y);
    } finally {
      await app.close();
    }
  });

  test("US7-10 US7-11 the floating menu has two rows and a label column that keeps its width in every language", async () => {
    const { app, page } = await launch();
    try {
      for (const lang of ["en", "pt-BR", "it", "es-ES", "fr"]) {
        await setLanguage(page, lang, lang);
        await page.keyboard.press("Escape");
        await card(page, "Notes").locator(".title").click();
        const editor = page
          .getByTestId("details-panel")
          .locator(".ProseMirror")
          .last();
        await editor.click();
        // 018 FR-036: the table options' third row shows only in a table.
        await expect(fmenu(page).locator(".fm-row:not([hidden])")).toHaveCount(2);
        // 014 FR-018: the split is the same in every language.
        for (const row of [0, 1])
          await expect(
            fmenu(page)
              .locator(".fm-row")
              .nth(row)
              .locator("button:not([hidden])"),
            lang,
          ).toHaveCount(10);
        // The menu floats with the selection; the buttons' place inside it is what must not move (FR-040).
        const offset = () =>
          fmenu(page).evaluate(
            (m) =>
              (
                m.querySelector('button[data-cmd="strong"]') as HTMLElement
              ).getBoundingClientRect().left - m.getBoundingClientRect().left,
          );
        const first = await offset();
        await page.keyboard.press("ControlOrMeta+a");
        await expect(fmenu(page).locator(".fm-scope")).not.toHaveText(/^$/);
        const second = await offset();
        expect(second, lang).toBe(first);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    } finally {
      await app.close();
    }
  });
});
