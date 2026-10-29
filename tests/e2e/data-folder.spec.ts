import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";

test("the default data folder is named Vesta under the OS app data folder (FR-038)", async () => {
  const { app } = await launchVesta();
  try {
    // Read through Electron without writing anything there: the test run uses VESTA_DATA_DIR.
    const { name, appData } = await app.evaluate(({ app: a }) => ({ name: a.getName(), appData: a.getPath("appData") }));
    expect(name).toBe("Vesta");
    const expected = join(appData, "Vesta");
    expect(expected.endsWith(`${process.platform === "win32" ? "\\" : "/"}Vesta`)).toBe(true);
    const session = await app.evaluate(({ app: a }) => a.getPath("sessionData"));
    expect(session.endsWith("Session")).toBe(true);
  } finally {
    await app.close();
  }
});
