import { describe, expect, it } from "vitest";
import { preserveUnedited } from "../../../../src/domain/markdown/preserve";

const kept = (source: string) => ({ source, md: `canonical(${source})` });
const edited = (md: string) => ({ source: null, md });

describe("preserveUnedited (FR-015b other spellings)", () => {
  it("writes unedited blocks as their original source", () => {
    const original = "_x_\n\n* item\n* two\n\n1) one";
    expect(preserveUnedited(original, [kept("_x_"), kept("* item\n* two"), kept("1) one")])).toBe(original);
  });

  it("writes edited blocks with the new markdown", () => {
    expect(preserveUnedited("_x_\n\n_y_", [kept("_x_"), edited("*y!*")])).toBe("_x_\n\n*y!*");
  });

  it("keeps the separators between unedited blocks", () => {
    const original = "a\n\n\n\nb\n\nc";
    expect(preserveUnedited(original, [kept("a"), kept("b"), kept("c")])).toBe(original);
  });

  it("separates new and edited blocks by a blank line", () => {
    expect(preserveUnedited("a\n\n\n\nb", [kept("a"), edited("new"), kept("b")])).toBe("a\n\nnew\n\nb");
    expect(preserveUnedited("a\n\nold\n\nb", [kept("a"), kept("b")])).toBe("a\n\nb");
  });

  it("keeps leading and trailing whitespace of an unedited document", () => {
    expect(preserveUnedited("a\n", [kept("a")])).toBe("a\n");
    expect(preserveUnedited("\na", [kept("a")])).toBe("\na");
  });

  it("finds repeated sources in order", () => {
    const original = "x\n\ny\n\n\nx";
    expect(preserveUnedited(original, [kept("x"), kept("y"), kept("x")])).toBe(original);
  });

  it("gives an empty string for an empty document", () => {
    expect(preserveUnedited("", [])).toBe("");
    expect(preserveUnedited("old", [])).toBe("");
  });

  it("uses only new markdown for a fully edited document", () => {
    expect(preserveUnedited("_a_\n\n_b_", [edited("*a*"), edited("*b*")])).toBe("*a*\n\n*b*");
  });
});
