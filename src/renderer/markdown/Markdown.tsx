// Read-only markdown for cards, the Archive, the Trash and the panel (FR-037, research §5).
import { memo, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { ASSET_PROTOCOL, linkTitleOf, youtubeEmbedId } from "../../domain/markdown/policy";
import { t } from "../i18n/t";
import { reportError } from "../report";
import { applyRendered, renderMarkdown, type RenderScope } from "./render";
import { mountEmbed } from "./youtube";
import { actions, useVesta } from "../store/store";

/** FR-031: web links open in the browser; stored files with their default app (or the file manager). */
export function openLink(href: string, name = ""): void {
  const stored = href.startsWith(ASSET_PROTOCOL);
  const call = stored
    ? window.vesta.assets.open({ ref: href.slice(ASSET_PROTOCOL.length) })
    : window.vesta.app.openExternal({ url: href });
  void call.then(
    (result) => {
      if (result.ok) return;
      // FR-033: a stored file missing from the folder.
      if (stored && result.error.code === "NOT_FOUND") actions.showAssetNotice(t("fileMissing", { n: name }));
      reportError(`markdown.open ${result.error.code}`, result.error.message);
    },
    (err: unknown) => {
      reportError("markdown.open", err);
    },
  );
}

/** "Cmd+click to open" on macOS, "Ctrl+click to open" elsewhere (FR-031); 010 FR-027 (I2): with the destination host first. */
export function linkHint(host: string | null = null): string {
  const hint = t("linkHint", { k: navigator.userAgent.includes("Mac") ? "Cmd" : "Ctrl" });
  return host === null || host === "" ? hint : `${host} · ${hint}`;
}

/** The per-link hint for the editors (010 FR-027). */
export function linkHintFor(href: string): string {
  return linkHint(linkTitleOf(href));
}

function placeholder(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.mdPlaceholder = "file-missing";
  span.textContent = text;
  return span;
}

/** Localized placeholders and the CSSOM styles the HTML cannot carry. */
function finish(root: HTMLElement): void {
  applyRendered(root);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-md-placeholder='remote-image']"))) {
    el.textContent = t("remoteImage", { u: el.dataset.url ?? "" });
  }
}

interface Props {
  md: string;
  scope: RenderScope;
  className?: string;
  /**
   * 016 FR-016c (Q257): a click or Enter on the n-th unsafe link of an editable title or reminder (inline editing
   * starts on it). Without it (the Archive, the Trash, the read-only panel) the "will not be opened" line shows.
   */
  onUnsafeLink?: (index: number) => void;
}

/** The unsafe link (`[data-unsafe-link]`, sanitize.ts) an event is on, inside `root`. */
function unsafeLinkOf(target: EventTarget, root: HTMLElement): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-unsafe-link]") : null;
  return el !== null && root.contains(el) ? el : null;
}

export const Markdown = memo(function Markdown({ md, scope, className, onUnsafeLink }: Props) {
  // 007: re-render on a language switch, which memo would skip (research §4).
  useVesta((s) => s.language);
  const ref = useRef<HTMLElement | null>(null);
  const { html } = renderMarkdown(md, scope);

  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null) return;
    finish(root);
    // FR-033: a stored file missing from the folder shows its name instead of a broken image.
    const onError = (e: Event) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !root.contains(img)) return;
      reportError("asset.missing", img.getAttribute("src") ?? "");
      img.replaceWith(placeholder(t("fileMissing", { n: img.alt })));
    };
    root.addEventListener("error", onError, true);
    // FR-034: a lone YouTube line in the details plays from youtube-nocookie.com.
    // 010 FR-015 (L2): the id comes from the validated link, never from the attribute (which only marks the container).
    const embeds = Array.from(root.querySelectorAll<HTMLElement>("[data-yt]")).map((el) => {
      const href = el.querySelector("a")?.getAttribute("href") ?? "";
      return mountEmbed(el, youtubeEmbedId(href) ?? "", href);
    });
    return () => {
      root.removeEventListener("error", onError, true);
      for (const stop of embeds) stop();
    };
  }, [html]);

  // 016 FR-016c: an unsafe link opens nothing and shows no notification.
  const unsafe = (el: HTMLElement, root: HTMLElement) => {
    if (onUnsafeLink === undefined) {
      actions.showUnsafeLinkPop(el);
      return;
    }
    onUnsafeLink(Array.from(root.querySelectorAll("[data-unsafe-link]")).indexOf(el));
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const bad = unsafeLinkOf(e.target, e.currentTarget);
    if (bad !== null) {
      e.preventDefault();
      e.stopPropagation();
      unsafe(bad, e.currentTarget);
      return;
    }
    const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (link === null || !e.currentTarget.contains(link)) return;
    // A link opens, and the click does not reach the card (no panel, FR-001).
    e.preventDefault();
    e.stopPropagation();
    openLink(link.getAttribute("href") ?? "", link.textContent);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter") return;
    const bad = unsafeLinkOf(e.target, e.currentTarget);
    if (bad === null) return;
    e.preventDefault();
    e.stopPropagation();
    unsafe(bad, e.currentTarget);
  };

  // 016 FR-016: a right-click on a safe link opens the link context menu; an unsafe one gets no menu.
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    if (unsafeLinkOf(e.target, e.currentTarget) !== null) {
      e.preventDefault();
      return;
    }
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (link === null || !e.currentTarget.contains(link)) return;
    e.preventDefault();
    e.stopPropagation();
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actions.openLinkMenu({ x: e.clientX, y: e.clientY, href: link.getAttribute("href") ?? "", text: link.textContent, back });
  };

  const block = scope === "details" || scope === "release";
  const classes = [block ? "md-block" : "md-inline", className].filter(Boolean).join(" ");
  if (block) {
    return (
      <div
        ref={(el) => {
          ref.current = el;
        }}
        className={classes}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <span
      ref={(el) => {
        ref.current = el;
      }}
      className={classes}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
