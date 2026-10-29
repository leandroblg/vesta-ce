import { describe, expect, it } from "vitest";
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  FORBID_TAGS,
  imageAllowed,
  linkAllowed,
  isYoutubeId,
  linkTitleOf,
  youtubeEmbedId,
} from "../../../../src/domain/markdown/policy";

const HASH = "0123456789abcdef".repeat(4);
const REF = `assets/${HASH}.pdf`;
const ID = "dQw4w9WgXcQ";

describe("sanitization policy as data (FR-035)", () => {
  it("allows exactly FR-035's elements", () => {
    const expected = [
      ...["b", "strong", "i", "em", "u", "s", "del", "mark", "sub", "sup", "small", "code", "kbd", "pre", "span"],
      ...["br", "p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "ul", "ol", "li"],
      ...["table", "thead", "tbody", "tr", "th", "td", "details", "summary", "a", "img", "iframe"],
    ];
    expect([...ALLOWED_TAGS].sort()).toEqual([...expected].sort());
  });

  it("allows exactly FR-035's attributes, without style, class or id", () => {
    const expected = [
      "href",
      "src",
      "alt",
      "title",
      "colspan",
      "rowspan",
      "open",
      "width",
      "height",
      "allowfullscreen",
    ];
    expect([...ALLOWED_ATTR].sort()).toEqual([...expected].sort());
    for (const name of ["style", "class", "id", "onerror", "onclick"]) expect(ALLOWED_ATTR).not.toContain(name);
  });

  it("removes FR-035's dangerous elements whole", () => {
    for (const tag of ["script", "style", "form", "input", "button", "textarea", "select", "object", "embed"]) {
      expect(FORBID_TAGS).toContain(tag);
    }
    for (const tag of ["svg", "math", "base", "meta", "link"]) expect(FORBID_TAGS).toContain(tag);
    for (const tag of FORBID_TAGS) expect(ALLOWED_TAGS).not.toContain(tag);
  });
});

describe("linkAllowed (FR-035a)", () => {
  it.each(["https://example.com", "http://example.com/a?b=c", "mailto:me@example.com", "HTTPS://EXAMPLE.COM", REF])(
    "allows %s",
    (url) => {
      expect(linkAllowed(url)).toBe(true);
    },
  );

  it("allows a stored file through the asset protocol", () => {
    expect(linkAllowed(`vesta-asset://${REF}`)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "relative/page.html",
    "assets/../secret",
    `vesta-asset://assets/../${HASH}`,
  ])("refuses %j", (url) => {
    expect(linkAllowed(url)).toBe(false);
  });
});

describe("imageAllowed (FR-035a)", () => {
  it("allows stored files only", () => {
    expect(imageAllowed(`assets/${HASH}.png`)).toBe(true);
    expect(imageAllowed(`vesta-asset://assets/${HASH}.png`)).toBe(true);
    expect(imageAllowed("https://example.com/x.png")).toBe(false);
    expect(imageAllowed("data:image/png;base64,AAAA")).toBe(false);
    expect(imageAllowed("file:///x.png")).toBe(false);
  });
});

describe("youtubeEmbedId (FR-034, FR-035)", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42`,
    `https://youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=1`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?start=10`,
  ])("reads the id of %s", (url) => {
    expect(youtubeEmbedId(url)).toBe(ID);
  });

  it.each([
    `http://www.youtube.com/watch?v=${ID}`,
    `http://youtu.be/${ID}`,
    `https://vimeo.com/${ID}`,
    `https://www.youtube.com.evil.example/watch?v=${ID}`,
    `https://youtube.com.evil.example/embed/${ID}`,
    `https://evil.example/https://youtu.be/${ID}`,
    `https://www.youtube.com/watch?v=dQw4w9WgXc`,
    `https://www.youtube.com/watch?v=dQw4w9WgXcQQ`,
    `https://youtu.be/dQw4w9WgX!Q`,
    `https://www.youtube.com/embed/dQw4w9WgXc`,
    `https://www.youtube.com/watch?vv=${ID}`,
    `https://user@www.youtube.com/embed/${ID}`,
    "",
  ])("rejects %j", (url) => {
    expect(youtubeEmbedId(url)).toBeNull();
  });
});

describe("L2 isYoutubeId and I2 linkTitleOf (010 FR-015, FR-027)", () => {
  it("L2 accepts exactly 11 characters of letters, digits, underscore and dash", () => {
    expect(isYoutubeId("dQw4w9WgXcQ")).toBe(true);
    expect(isYoutubeId("a-b_c-d_e-f")).toBe(true);
    expect(isYoutubeId("dQw4w9WgXc")).toBe(false);
    expect(isYoutubeId("dQw4w9WgXcQQ")).toBe(false);
    expect(isYoutubeId("../../x?autoplay=1")).toBe(false);
    expect(isYoutubeId("")).toBe(false);
    expect(isYoutubeId("dQw4w9WgX.Q")).toBe(false);
  });

  it("I2 names the host of a web link, the address of a mail link and nothing for the rest", () => {
    expect(linkTitleOf("https://example.com/path?q=1")).toBe("example.com");
    expect(linkTitleOf("http://sub.example.org:8080/")).toBe("sub.example.org:8080");
    expect(linkTitleOf("mailto:ana@example.com?subject=hi")).toBe("ana@example.com");
    expect(linkTitleOf(`assets/${HASH}.pdf`)).toBeNull();
    expect(linkTitleOf("javascript:alert(1)")).toBeNull();
    expect(linkTitleOf("not a url")).toBeNull();
  });
});
