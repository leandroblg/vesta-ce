// 018 US1 (FR-001 to FR-004, SC-001; PRD Q270, Q284): the Community Edition superscript on the wordmark, in the
// window identity and About, and About's "Community Edition" line; everything else that names the app says "Vesta".
import { expect, test, type Locator, type Page } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";
import { clickMenu, menuTitles } from "./fixtures/menu";
import { IS_MAC } from "./fixtures/settings";

const PALETTES = ["hearth", "system", "ubuntu", "minimal"] as const;
const about = (page: Page) => page.getByTestId("about-dialog");

/** The superscript's and its wordmark's geometry and style, the wordmark text measured without the superscript. */
function measure(wordmark: Locator) {
  return wordmark.evaluate((el) => {
    const sup = el.querySelector("sup.ed");
    const text = el.firstChild;
    if (sup === null || text === null || text.nodeType !== Node.TEXT_NODE) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    const t = range.getBoundingClientRect();
    const s = sup.getBoundingClientRect();
    const cs = getComputedStyle(sup);
    const ws = getComputedStyle(el);
    return {
      text: sup.textContent,
      hidden: sup.getAttribute("aria-hidden"),
      color: cs.color,
      wordColor: ws.color,
      family: cs.fontFamily,
      wordFamily: ws.fontFamily,
      gap: s.left - t.right,
      supTop: s.top,
      textTop: t.top,
      textHeight: t.height,
      sizeRatio: parseFloat(cs.fontSize) / parseFloat(ws.fontSize),
      visible: (sup as HTMLElement).offsetParent !== null,
    };
  });
}

function expectExponent(m: Awaited<ReturnType<typeof measure>>, where: string): void {
  expect(m, where).not.toBeNull();
  if (m === null) return;
  expect(m.text, where).toBe("CE");
  expect(m.hidden, where).toBe("true");
  expect(m.color, where).toBe(m.wordColor);
  expect(m.family, where).toBe(m.wordFamily);
  // Upper right, like an exponent: right after the word, raised above its upper quarter.
  expect(m.gap, where).toBeGreaterThanOrEqual(-0.5);
  expect(m.gap, where).toBeLessThanOrEqual(3);
  expect(m.supTop, where).toBeLessThan(m.textTop + m.textHeight / 4);
  // T091: about half the wordmark's size.
  expect(m.sizeRatio, where).toBeGreaterThanOrEqual(0.45);
  expect(m.sizeRatio, where).toBeLessThanOrEqual(0.6);
}

test("US1-1 US1-4 FR-001 the toolbar wordmark carries a CE superscript in its color and face, in every theme", async () => {
  const { app, page } = await launchVesta();
  try {
    const word = page.locator("header .brand-name");
    await expect(word).toBeVisible();
    for (const palette of PALETTES) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate((p) => {
          document.documentElement.dataset["palette"] = p;
        }, palette);
        expectExponent(await measure(word), `${palette} ${colorScheme}`);
      }
    }
    // Screen readers hear the edition written out; the superscript itself is hidden from them.
    await expect(word.locator("sup.ed + .sr-only")).toHaveText(" Community Edition");
  } finally {
    await app.close();
  }
});

test("US1-2 FR-002 Q284 About's wordmark carries the superscript and writes the edition out under it, centered", async () => {
  const { app, page } = await launchVesta();
  try {
    await clickMenu(app, "about");
    const d = about(page);
    await expect(d).toBeVisible();
    await expect(d).toHaveAccessibleName("About Vesta");
    const word = d.locator(".wordmark");
    for (const palette of PALETTES) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate((p) => {
          document.documentElement.dataset["palette"] = p;
        }, palette);
        expectExponent(await measure(word), `About ${palette} ${colorScheme}`);
      }
    }
    // The visible line names the edition, so the wordmark has no screen-reader text of its own.
    await expect(word.locator(".sr-only")).toHaveCount(0);
    const line = d.locator(".about-edition");
    await expect(line).toHaveText("Community Edition");
    const g = await d.evaluate((root) => {
      const w = root.querySelector(".wordmark") as HTMLElement;
      const l = root.querySelector(".about-edition") as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(w);
      const wr = range.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      const lineRange = document.createRange();
      lineRange.selectNodeContents(l);
      const lt = lineRange.getBoundingClientRect();
      return {
        below: lr.top - w.getBoundingClientRect().bottom,
        center: Math.abs(lt.left + lt.width / 2 - (wr.left + wr.width / 2)),
        size: Number.parseFloat(getComputedStyle(l).fontSize),
        wordSize: Number.parseFloat(getComputedStyle(w).fontSize),
      };
    });
    expect(g.below).toBeGreaterThanOrEqual(0);
    expect(g.center).toBeLessThanOrEqual(1);
    expect(g.size).toBeLessThanOrEqual(g.wordSize / 2);
  } finally {
    await app.close();
  }
});

test("US1-5 FR-004 the window title, About's name and the app menu still say Vesta", async () => {
  const { app, page } = await launchVesta();
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe("Vesta");
    if (IS_MAC) expect((await menuTitles(app))[0]).toBe("Vesta");
    await clickMenu(app, "about");
    await expect(about(page)).toHaveAccessibleName("About Vesta");
  } finally {
    await app.close();
  }
});

test("US1-3 FR-003 a narrow window drops the superscript with the wordmark and brings both back", async () => {
  const { app, page } = await launchVesta();
  try {
    const shown = () =>
      page.evaluate(() => {
        const vis = (sel: string) => {
          const el = document.querySelector<HTMLElement>(sel);
          return el !== null && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
        };
        return { name: vis(".brand-name"), sup: vis(".brand-name sup.ed"), level: document.querySelector("header.topbar")?.getAttribute("data-fit") };
      });
    for (const width of [900, 700, 560, 480, 420, 390, 360, 900]) {
      await app.evaluate(({ BrowserWindow }, w) => {
        BrowserWindow.getAllWindows()[0]?.setSize(w, 760);
      }, width);
      await page.waitForFunction((w) => window.innerWidth <= w, width);
      await page.waitForTimeout(100);
      const s = await shown();
      expect(s.sup, `${String(width)} px, level ${String(s.level)}`).toBe(s.name);
      expect(s.name, `${String(width)} px`).toBe(Number(s.level) < 2);
    }
  } finally {
    await app.close();
  }
});
