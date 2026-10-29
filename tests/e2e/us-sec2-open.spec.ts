// 010 US2 (M4, I2; FR-006, FR-027): opening a stored file never runs a program; link tooltips name the destination.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { caretAtEnd } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addTasks, seedAsset, seedTasks, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

async function stubShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { shellCalls: string[] };
    g.shellCalls = [];
    shell.openPath = (p: string) => {
      g.shellCalls.push(`openPath ${p}`);
      return Promise.resolve("");
    };
    shell.showItemInFolder = (p: string) => {
      g.shellCalls.push(`show ${p}`);
    };
    shell.openExternal = (u: string) => {
      g.shellCalls.push(`external ${u}`);
      return Promise.resolve();
    };
  });
}
const shellCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { shellCalls: string[] }).shellCalls);

async function openDetails(page: Page, title: string): Promise<void> {
  await taskCard(page, title).locator(".title").click();
  await expect(details(page)).toBeVisible();
  await caretAtEnd(details(page));
}

test.describe("010 US2 — opening a stored file or a link never surprises me (M4, I2)", () => {
  test("M4 allow-listed types open with the default application; every other stored file is shown in the file manager", async () => {
    const dataDir = freshDataDir();
    const bytes = (text: string) => new TextEncoder().encode(text);
    const pdf = seedAsset(dataDir, bytes("%PDF-1.4 report"), "pdf");
    const png = seedAsset(dataDir, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), "png");
    const jar = seedAsset(dataDir, bytes("PK jar"), "jar");
    const html = seedAsset(dataDir, bytes("<html>page</html>"), "html");
    const svg = seedAsset(dataDir, bytes("<svg/>"), "svg");
    const docm = seedAsset(dataDir, bytes("PK macros"), "docm");
    const noExt = seedAsset(dataDir, bytes("no extension"), "");
    const links = [
      `[report.pdf](${pdf})`,
      `[photo.png](${png})`,
      `[tool.jar](${jar})`,
      `[page.html](${html})`,
      `[logo.svg](${svg})`,
      `[macros.docm](${docm})`,
      `[noext](${noExt})`,
    ].join(" ");
    const a = task({ titleMd: "Open files", detailsMd: links });
    addTasks(dataDir, [a]); // the asset seeding created the database
    const { app, page } = await launchVesta({ dataDir });
    await stubShell(app);
    try {
      await openDetails(page, "Open files");
      for (const name of ["report.pdf", "photo.png", "tool.jar", "page.html", "logo.svg", "macros.docm", "noext"]) {
        await details(page).locator("a", { hasText: name }).click({ modifiers: ["ControlOrMeta"] });
      }
      await expect.poll(() => shellCalls(app)).toEqual([
        expect.stringMatching(/^openPath .*assets\/[0-9a-f]{64}\.pdf$/),
        expect.stringMatching(/^openPath .*assets\/[0-9a-f]{64}\.png$/),
        expect.stringMatching(/^show .*assets\/[0-9a-f]{64}\.jar$/),
        expect.stringMatching(/^show .*assets\/[0-9a-f]{64}\.html$/),
        expect.stringMatching(/^show .*assets\/[0-9a-f]{64}\.svg$/),
        expect.stringMatching(/^show .*assets\/[0-9a-f]{64}\.docm$/),
        expect.stringMatching(/^show .*assets\/[0-9a-f]{64}$/),
      ]);
    } finally {
      await app.close();
    }
  });

  test("I2 a web link's tooltip names its host, on the card and in the editor", async () => {
    const dataDir = freshDataDir();
    // The linked title stays on its own card (a click on it would open the link, FR-031); the plain card opens the panel.
    const linked = task({ titleMd: "Read [the docs](https://docs.example.com/guide)" });
    const plain = task({ titleMd: "Plain title", detailsMd: "Write to [us](mailto:ana@example.com) or see [bank](https://evil.example/x)" });
    seedTasks(dataDir, [linked, plain]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const cardLink = page.locator("li[data-kind='task'] .title a", { hasText: "the docs" });
      await expect(cardLink).toHaveAttribute("title", "docs.example.com");
      await taskCard(page, "Plain title").locator(".title").click();
      await expect(details(page)).toBeVisible();
      await expect(details(page).locator("a", { hasText: "us" })).toHaveAttribute("title", /^ana@example\.com · (Cmd|Ctrl)\+click to open$/);
      await expect(details(page).locator("a", { hasText: "bank" })).toHaveAttribute("title", /^evil\.example · (Cmd|Ctrl)\+click to open$/);
    } finally {
      await app.close();
    }
  });
});
