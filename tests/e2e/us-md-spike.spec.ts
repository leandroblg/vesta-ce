// The 005 spike (research §1, tasks T016): PRD B3's items in real Chromium, in the built app under the
// production CSP. Items 1 and 2 (round-trip, custom syntax) are tests/unit/editor/editor.roundtrip.test.ts.
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, type Launched } from "./fixtures/launch";
import { seedAsset, seedTasks, task } from "./fixtures/seed";
import { createHash } from "node:crypto";
import { expectNoA11yViolations } from "./fixtures/axe";
import { PRODUCTION_CSP } from "../../src/main/csp";

// A 4 × 2 PNG: an image with a known aspect ratio.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC";

type Scope = "title" | "reminder" | "details";

/** Launches with one stored PNG; IMAGE is its markdown reference. */
let IMAGE = "";
async function launchWithImage(): Promise<Launched> {
  const dataDir = freshDataDir();
  const bytes = Buffer.from(PNG, "base64");
  IMAGE = `assets/${createHash("sha256").update(bytes).digest("hex")}.png`;
  // An archived task references the image, so the launch purge keeps it (FR-032).
  seedTasks(dataDir, [task({ titleMd: "Keeper", doneAt: Date.now(), detailsMd: `![k](${IMAGE})` })]);
  seedAsset(dataDir, bytes, "png", "image/png");
  return launchVesta({ dataDir });
}

async function watchCsp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.cspViolations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`);
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);

async function mount(page: Page, scope: Scope, md: string): Promise<number> {
  return page.evaluate(
    ([s, m]) => {
      const hooks = window.__vestaTest;
      if (!hooks) throw new Error("test hooks missing");
      return hooks.mountEditor(s, m);
    },
    [scope, md] as const,
  );
}

const markdownOf = (page: Page, index: number) => page.evaluate((i) => window.__vestaTest?.editorMarkdown(i), index);
const editor = (page: Page, index: number) => page.locator(`[data-testid='test-editor-${String(index)}'] .ProseMirror`);

test.describe("005 spike (research §1)", () => {
  test("item 3: an inline image in a title is the height of the line's font", async () => {
    const { app, page } = await launchWithImage();
    try {
      const index = await mount(page, "title", `Renew ![photo.png](${IMAGE}) passport`);
      const img = editor(page, index).locator("img");
      await expect(img).toHaveAttribute("src", `vesta-asset://${IMAGE}`);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(4);
      const { height, width, fontSize } = await img.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const line = el.closest("p, h1, h2, h3, h4, h5, h6");
        return { height: box.height, width: box.width, fontSize: parseFloat(getComputedStyle(line ?? el).fontSize) };
      });
      expect(Math.abs(height - fontSize)).toBeLessThanOrEqual(1);
      expect(Math.abs(width - 2 * height)).toBeLessThanOrEqual(1); // proportional width (FR-017)
      expect(await markdownOf(page, index)).toBe(`Renew ![photo.png](${IMAGE}) passport`);
    } finally {
      await app.close();
    }
  });

  test("item 4: IME composition inserts the text, and Enter during composition does not save", async () => {
    const { app, page } = await launchVesta();
    try {
      for (const scope of ["title", "details"] as const) {
        const index = await mount(page, scope, "");
        await editor(page, index).click();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
        await cdp.send("Input.imeSetComposition", { text: "にほんご", selectionStart: 4, selectionEnd: 4 });
        // Enter while composing belongs to the composition (FR-022).
        const prevented = await editor(page, index).evaluate((el) => {
          const event = new KeyboardEvent("keydown", {
            key: "Enter",
            isComposing: true,
            bubbles: true,
            cancelable: true,
          });
          el.dispatchEvent(event);
          return event.defaultPrevented;
        });
        expect(prevented).toBe(false);
        await cdp.send("Input.insertText", { text: "にほんご" });
        await expect.poll(() => markdownOf(page, index)).toBe("にほんご");
        expect(await page.evaluate((i) => window.__vestaTest?.editorKeys(i), index)).toEqual([]);
        // A dead key (´ then e) composes é.
        await cdp.send("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
        await cdp.send("Input.insertText", { text: "é" });
        await expect.poll(() => markdownOf(page, index)).toBe("にほんごé");
        if (scope === "title") {
          await page.keyboard.press("Enter");
          expect(await page.evaluate((i) => window.__vestaTest?.editorKeys(i), index)).toEqual(["enter"]);
        }
        await cdp.detach();
      }
    } finally {
      await app.close();
    }
  });

  test("item 5: the editors pass an axe scan and have accessible names", async () => {
    const { app, page } = await launchWithImage();
    try {
      const title = await mount(page, "title", `**Renew** [passport]{color="#dd3333ff"} ==soon== ![photo.png](${IMAGE})`);
      const details = await mount(
        page,
        "details",
        "# Notes\n\n- [ ] one\n- [x] two\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n> quote",
      );
      await expect(editor(page, title)).toHaveAttribute("role", "textbox");
      await expect(page.getByRole("textbox", { name: `Test editor ${String(title)}` })).toBeVisible();
      await expect(page.getByRole("textbox", { name: `Test editor ${String(details)}` })).toHaveAttribute(
        "aria-multiline",
        "true",
      );
      await expectNoA11yViolations(page, "spike editors");
    } finally {
      await app.close();
    }
  });

  test("item 6: 1,000 formatted rows render within the SC-003 budget", async () => {
    const { app, page } = await launchWithImage();
    try {
      const rows = Array.from({ length: 1000 }, (_, i) =>
        i % 10 === 0
          ? `Row ${String(i)} ![photo.png](${IMAGE}) **bold**`
          : i % 3 === 0
            ? `**Row** ${String(i)} [colored]{color="#dd3333ff"} ==mark== ~~old~~`
            : `Plain row ${String(i)}`,
      );
      const ms = await page.evaluate((mds) => window.__vestaTest?.renderRows(mds, "title"), rows);
      expect(ms).toBeLessThan(2000);
      await expect(page.locator("[data-testid='test-rows'] > div")).toHaveCount(1000);
      // Scroll through the list; no frame may take over 50 ms.
      const longest = await page.evaluate(async () => {
        const layer = document.querySelector("[data-testid='test-layer']");
        if (!layer) throw new Error("no layer");
        let last = performance.now();
        let worst = 0;
        for (let i = 0; i < 60; i++) {
          layer.scrollTop += 400;
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
        }
        return worst;
      });
      expect(longest).toBeLessThan(50);
    } finally {
      await app.close();
    }
  });

  test("item 7: under the exact production CSP, both presets and the renderer raise no violation and keep their formatting", async () => {
    const { app, page } = await launchWithImage();
    try {
      const meta = await page.locator("meta[http-equiv='Content-Security-Policy']").getAttribute("content");
      expect(meta).toBe(PRODUCTION_CSP);
      await watchCsp(page);
      // 011 FR-009: a text color that already meets AA on its highlight is drawn exactly as stored.
      const md = `**b** [c]{color="#1d4ed8ff" bg="#ffe066ff" size="1.5em" .underline} ==m== ![p](${IMAGE})`;
      const title = await mount(page, "title", md);
      const details = await mount(
        page,
        "details",
        `${md}\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n<b>html</b>`,
      );
      await page.evaluate(
        (m) =>
          window.__vestaTest?.renderRows(
            [m, "| a | b |\n| --- | :-: |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```"],
            "details",
          ),
        md,
      );

      for (const root of [editor(page, title), editor(page, details), page.locator("[data-testid='test-rows']")]) {
        const span = root.locator("[data-vesta-span]").first();
        await expect(span).toHaveCSS("color", "rgb(29, 78, 216)");
        await expect(span).toHaveCSS("background-color", "rgb(255, 224, 102)");
        await expect(span).toHaveCSS("text-decoration-line", "underline");
        const sizes = await span.evaluate((el) => [
          parseFloat(getComputedStyle(el).fontSize),
          parseFloat(getComputedStyle(el.parentElement ?? el).fontSize),
        ]);
        expect(sizes[0]).toBeCloseTo((sizes[1] ?? 0) * 1.5, 0);
        await expect(root.locator("mark").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      for (const root of [editor(page, details), page.locator("[data-testid='test-rows']")]) {
        await expect(root.locator("td").nth(1)).toHaveCSS("text-align", "center");
        await expect(root.locator("pre").first()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      // Highlighted tokens, in the editor (prism decorations) and in the renderer (data attributes).
      await expect(editor(page, details).locator(".token.keyword").first()).toHaveCSS("font-weight", "600");
      await expect(page.locator("[data-testid='test-rows'] [data-tk~='keyword']").first()).toHaveCSS(
        "font-weight",
        "600",
      );

      // Editing applies formatting under the CSP too.
      // The caret at the end of the document, through the DOM selection ProseMirror follows.
      await editor(page, details).evaluate((el: HTMLElement) => {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await expect.poll(() => editor(page, details).evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.type(" **more**");
      await expect.poll(() => markdownOf(page, details)).toContain("**more**");
      expect(await violations(page)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
