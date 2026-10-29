import { describe, expect, it } from "vitest";
import { hashOfRef, selectUnreferencedAssets } from "../../../src/domain/purge";
import { mk, mkReminder } from "./fixtures";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const row = (sha256: string, ext: string) => ({ sha256, ext });

describe("selectUnreferencedAssets (005 FR-032)", () => {
  it("keeps files referenced from titles, details and reminders in any state", () => {
    const assets = [row(A, "png"), row(B, "pdf"), row(C, "")];
    const tasks = [
      mk({ titleMd: `x ![p](assets/${A}.png)`, doneAt: 5 }),
      mk({ detailsMd: `[f](assets/${B}.pdf)`, deletedAt: 9 }),
    ];
    const reminders = [mkReminder({ textMd: `![r](assets/${C})` })];
    expect(selectUnreferencedAssets(assets, tasks, reminders)).toEqual([]);
  });

  it("returns the paths of unreferenced files, with or without an extension", () => {
    const assets = [row(A, "png"), row(C, "")];
    expect(selectUnreferencedAssets(assets, [mk({ titleMd: "plain" })], [])).toEqual([
      `assets/${A}.png`,
      `assets/${C}`,
    ]);
  });

  it("does not count references inside code", () => {
    const tasks = [mk({ detailsMd: `\`![p](assets/${A}.png)\`\n\n\`\`\`\n[f](assets/${A}.png)\n\`\`\`` })];
    expect(selectUnreferencedAssets([row(A, "png")], tasks, [])).toEqual([`assets/${A}.png`]);
  });

  it("a shared file stays while any item references it", () => {
    const ref = `![p](assets/${A}.png)`;
    const a = mk({ detailsMd: ref });
    const b = mk({ detailsMd: `see ${ref}` });
    // A's reference is edited out and A is permanently deleted: B still references the file.
    expect(selectUnreferencedAssets([row(A, "png")], [b], [])).toEqual([]);
    expect(selectUnreferencedAssets([row(A, "png")], [a, b], [])).toEqual([]);
    // B's reference is removed too.
    expect(selectUnreferencedAssets([row(A, "png")], [{ ...b, detailsMd: "see" }], [])).toEqual([`assets/${A}.png`]);
  });

  it("keeps a file referenced twice in one task, or from a task and a reminder, while either reference exists", () => {
    const twice = mk({ detailsMd: `![1](assets/${A}.png) ![2](assets/${A}.png)` });
    expect(selectUnreferencedAssets([row(A, "png")], [twice], [])).toEqual([]);
    const task = mk({ detailsMd: `![1](assets/${A}.png)` });
    const rem = mkReminder({ textMd: `![2](assets/${A}.png)` });
    expect(selectUnreferencedAssets([row(A, "png")], [task], [rem])).toEqual([]);
    expect(selectUnreferencedAssets([row(A, "png")], [], [rem])).toEqual([]);
    expect(selectUnreferencedAssets([row(A, "png")], [task], [])).toEqual([]);
  });

  // 008 research §9 reverses 005's "a reference with another extension does not keep the stored file": see below.
});

describe("stored files are identified by hash (008 research §9, FR-034)", () => {
  it("hashOfRef gives the hash whatever the extension", () => {
    expect(hashOfRef(`assets/${A}.jpg`)).toBe(A);
    expect(hashOfRef(`assets/${A}.jpeg`)).toBe(A);
    expect(hashOfRef(`assets/${A}`)).toBe(A);
  });

  it("a file stored as .jpeg is in use when referenced as .jpg", () => {
    const assets = [row(A, "jpeg")];
    expect(selectUnreferencedAssets(assets, [mk({ detailsMd: `![p](assets/${A}.jpg)` })], [])).toEqual([]);
    expect(selectUnreferencedAssets(assets, [], [mkReminder({ textMd: `![p](assets/${A})` })])).toEqual([]);
  });
});
