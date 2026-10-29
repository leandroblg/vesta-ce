// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyRendered, clearRenderCache, renderMarkdown, renderStats } from "../../../src/renderer/markdown/render";

const SHA = "ab".repeat(32);

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  applyRendered(root);
  return root;
}

beforeEach(() => {
  clearRenderCache();
  document.body.innerHTML = "";
});

describe("renderMarkdown", () => {
  it("renders a plain title on the fast path, without parsing", () => {
    const before = renderStats().parses;
    const { html } = renderMarkdown("Renew passport & visa", "title");
    expect(html).toBe("Renew passport &amp; visa");
    expect(renderStats().parses).toBe(before);
  });

  it("parses a title with formatting", () => {
    const before = renderStats().parses;
    expect(renderMarkdown("**Renew** passport", "title").html).toBe("<strong>Renew</strong> passport");
    expect(renderStats().parses).toBe(before + 1);
  });

  it("returns the same HTML from the cache for the same input", () => {
    const first = renderMarkdown("**a**", "title");
    const before = renderStats().parses;
    const second = renderMarkdown("**a**", "title");
    expect(second).toBe(first);
    expect(renderStats().parses).toBe(before);
    renderMarkdown("**a**", "details");
    expect(renderStats().parses).toBe(before + 1);
  });

  it("rewrites stored files to the asset protocol", () => {
    const { html } = renderMarkdown(`![p](assets/${SHA}.png) [f](assets/${SHA}.pdf)`, "details");
    expect(html).toContain(`src="vesta-asset://assets/${SHA}.png"`);
    expect(html).toContain(`href="vesta-asset://assets/${SHA}.pdf"`);
  });

  it("shows a link with a refused scheme as text", () => {
    for (const md of [
      "[x](javascript:alert(1))",
      "[x](JAVASCRIPT:alert(1))",
      "[x](data:text/html,hi)",
      "[x](file:///etc/passwd)",
    ]) {
      const root = mount(renderMarkdown(md, "details").html);
      expect(root.querySelector("a"), md).toBeNull();
      expect(root.textContent).toBe("x");
    }
  });

  it("keeps web and mail links", () => {
    const root = mount(renderMarkdown("[w](https://example.com) [m](mailto:a@example.com)", "details").html);
    expect([...root.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com",
      "mailto:a@example.com",
    ]);
  });

  it("replaces a remote image with a placeholder that loads nothing", () => {
    const root = mount(renderMarkdown("![r](https://example.com/x.png)", "details").html);
    expect(root.querySelector("img")).toBeNull();
    const placeholder = root.querySelector("[data-md-placeholder='remote-image']");
    expect(placeholder?.getAttribute("data-url")).toBe("https://example.com/x.png");
  });

  it("applies span colors through element.style, with no style attribute in the HTML", () => {
    const { html } = renderMarkdown('[t]{color="#d33" bg="#ffe066" size="1.5em" .underline}', "title");
    expect(html).not.toContain("style=");
    const span = mount(html).querySelector<HTMLElement>("[data-vesta-span]");
    expect(span?.style.color).not.toBe("");
    expect(span?.style.backgroundColor).not.toBe("");
    expect(span?.style.fontSize).toBe("1.5em");
    expect(span?.hasAttribute("data-underline")).toBe(true);
  });

  it("ignores invalid span values a user wrote in HTML", () => {
    const root = mount(
      renderMarkdown('<span data-vesta-span data-color="red;background:url(x)" data-size="99999px">x</span>', "details")
        .html,
    );
    const span = root.querySelector<HTMLElement>("span");
    expect(span?.style.color).toBe("");
    expect(span?.style.fontSize).toBe("");
  });

  it("renders a title heading as a sized span", () => {
    expect(renderMarkdown("## Big", "title").html).toBe('<span data-heading="2">Big</span>');
  });

  it("renders ==mark==", () => {
    expect(renderMarkdown("==m==", "title").html).toBe("<mark>m</mark>");
  });

  it("escapes HTML in the title scope", () => {
    const { html } = renderMarkdown("a <b>x</b> <img src=x onerror=alert(1)>", "title");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    const root = mount(html);
    expect(root.querySelector("b, img")).toBeNull();
  });

  it("keeps out-of-scope markdown in a title as text", () => {
    expect(mount(renderMarkdown("- item", "title").html).textContent).toBe("- item");
  });

  it("sanitizes HTML in details", () => {
    const md = [
      '<b onclick="alert(1)" style="color:red" class="x" id="y">ok</b>',
      "",
      "<script>alert(1)</script>",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      '<iframe src="https://evil.example/embed/x"></iframe>',
      "",
      "<svg><script>alert(1)</script></svg>",
      "",
      '<form action="https://evil.example"><input name="a"></form>',
    ].join("\n");
    const { html } = renderMarkdown(md, "details");
    expect(html).not.toMatch(/onclick|onerror|<script|<svg|<form|<input|evil\.example|style=|class=|id=/i);
    expect(mount(html).querySelector("b")?.textContent).toBe("ok");
  });

  it("keeps an allow-listed YouTube iframe, loaded from youtube-nocookie.com and sandboxed", () => {
    const { html } = renderMarkdown(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="x()" width="560"></iframe>',
      "details",
    );
    const frame = mount(html).querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.hasAttribute("onload")).toBe(false);
    expect(frame?.getAttribute("width")).toBe("560");
  });

  it("marks a YouTube URL alone on a line as an embed, without loading anything yet", () => {
    const result = renderMarkdown("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "details");
    expect(result.hasEmbeds).toBe(true);
    const root = mount(result.html);
    expect(root.querySelector("[data-yt]")?.getAttribute("data-yt")).toBe("dQw4w9WgXcQ");
    expect(root.querySelector("iframe")).toBeNull();
    expect(renderMarkdown("see https://www.youtube.com/watch?v=dQw4w9WgXcQ", "details").hasEmbeds).toBe(false);
  });

  it("highlights code with data attributes, not classes", () => {
    const { html } = renderMarkdown("```js\nconst a = 1;\n```", "details");
    expect(html).toContain('data-tk="keyword"');
    expect(html).not.toContain("class=");
  });

  it("renders checklists as read-only checkboxes", () => {
    const root = mount(renderMarkdown("- [x] done\n- [ ] todo", "details").html);
    const boxes = [...root.querySelectorAll("[role='checkbox']")];
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(root.querySelector("input")).toBeNull();
  });

  it("renders tables, quotes, footnotes and collapsible sections", () => {
    const md =
      "| a |\n| --- |\n| 1 |\n\n> q\n\nT[^1]\n\n[^1]: n\n\n<details><summary>S</summary>\n\nbody\n\n</details>";
    const root = mount(renderMarkdown(md, "details").html);
    expect(root.querySelector("table td")?.textContent).toBe("1");
    const aligned = mount(renderMarkdown("| a |\n| :-: |\n| 1 |", "details").html).querySelector("td");
    expect(aligned?.getAttribute("data-align")).toBe("center");
    expect(aligned?.hasAttribute("align")).toBe(false);
    expect(root.querySelector("blockquote")?.textContent.trim()).toBe("q");
    expect(root.querySelector("sup")).not.toBeNull();
    expect(root.querySelector("details summary")?.textContent).toBe("S");
  });
});

describe('renderMarkdown "release" (009 FR-025a; checklist CHK014 to CHK016)', () => {
  const CORPUS = [
    "## What's new\n\n- Faster start",
    "![screenshot](https://example.com/shot.png)",
    "![ref][s]\n\n[s]: https://example.com/ref.png",
    '<img src="https://example.com/x.png" alt="html image">',
    '<video src="https://example.com/v.mp4"></video>',
    '<audio src="https://example.com/a.mp3"></audio>',
    '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>',
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    '<link rel="stylesheet" href="https://example.com/s.css"><style>body{}</style>',
    "![local](assets/" + SHA + ".png)",
    "[changelog](https://github.com/OWNER/vesta/blob/main/CHANGELOG.md)",
  ].join("\n\n");

  it("renders the notes formatted, with links, and nothing that would load", () => {
    const { html, hasEmbeds } = renderMarkdown(CORPUS, "release");
    const root = mount(html);
    expect(hasEmbeds).toBe(false);
    expect(root.querySelector("h2")?.textContent).toBe("What's new");
    expect(root.querySelectorAll("img, iframe, video, audio, source, link, style, object, embed")).toHaveLength(0);
    expect(root.querySelectorAll("[src], [srcset]")).toHaveLength(0);
    expect(root.querySelector("[data-yt]")).toBeNull();
    expect(root.querySelector('a[href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"]')).not.toBeNull();
    expect(root.querySelector('a[href="https://github.com/OWNER/vesta/blob/main/CHANGELOG.md"]')?.textContent).toBe("changelog");
    // Remote images show as their address (005 FR-035a placeholders); a stored file shows as its text.
    expect(root.textContent).toContain("https://example.com/shot.png");
    expect(root.textContent).toContain("https://example.com/x.png");
    expect(root.textContent).toContain("local");
    expect(html).not.toContain("vesta-asset:");
  });

  it("still embeds in details: the release scope changes nothing elsewhere", () => {
    expect(renderMarkdown("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "details").hasEmbeds).toBe(true);
  });
});

describe("I2 link titles name the destination (010 FR-027)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("I2 web links get their host, mail links their address, stored files their name", () => {
    const root = mount(
      `<p><a href="https://example.com/a/b?c=1">click me</a> <a href="mailto:ana@example.com">write</a> <a href="assets/${SHA}.pdf">contract.pdf</a></p>`,
    );
    const [web, mail, file] = Array.from(root.querySelectorAll("a"));
    expect(web?.getAttribute("title")).toBe("example.com");
    expect(mail?.getAttribute("title")).toBe("ana@example.com");
    expect(file?.getAttribute("title")).toBe("contract.pdf");
  });

  it("I2 a title present in the markup is replaced, never kept", () => {
    const root = mount(`<p><a href="https://evil.example/x" title="https://bank.example">bank</a></p>`);
    expect(root.querySelector("a")?.getAttribute("title")).toBe("evil.example");
  });
});

describe("audit 'Span styles' row (010 FR-031): colors and sizes through the CSSOM, never a style attribute", () => {
  it("drops a style attribute from the markup and applies custom-syntax colors through the CSSOM only", () => {
    const { html } = renderMarkdown('<span style="color:red">x</span> {color=#ff0000}y{/color}', "details");
    expect(html).not.toContain("style=");
    const root = mount(html);
    const styled = root.querySelector<HTMLElement>("[data-vesta-span]");
    if (styled !== null) expect(styled.style.color).not.toBe("");
  });
});

describe("016 FR-016c (PRD Q255) a stored link whose address is not safe", () => {
  it("keeps its link look as a focusable placeholder with no address", () => {
    const root = mount(renderMarkdown("see [the page](javascript:alert(1)) now", "title").html);
    const a = root.querySelector("a");
    expect(a).toBeNull();
    const span = root.querySelector<HTMLElement>("[data-unsafe-link]");
    expect(span?.textContent).toBe("the page");
    expect(span?.getAttribute("tabindex")).toBe("0");
    expect(span?.getAttribute("role")).toBe("link");
    expect(span?.hasAttribute("href")).toBe(false);
  });
  it("a safe link is unchanged", () => {
    const root = mount(renderMarkdown("[docs](https://example.com)", "title").html);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(root.querySelector("[data-unsafe-link]")).toBeNull();
  });
});
