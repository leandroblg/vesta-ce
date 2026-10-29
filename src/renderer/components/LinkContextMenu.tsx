/**
 * 016 FR-016, FR-016a, FR-016c (PRD Q234, Q241, Q255, Q257; ui.md "Link context menu"): the menu a right-click on a
 * safe link opens, at the pointer, in any editor or read-only text; and the "will not be opened" line at an unsafe
 * link in a read-only place. Both close on Esc or a click elsewhere, the focus going back where it was.
 */
import { useEffect, useRef } from "react";
import { isAssetRef } from "../../domain/markdown/assets";
import { ASSET_PROTOCOL } from "../../domain/markdown/policy";
import { t } from "../i18n/t";
import { openLink } from "../markdown/Markdown";
import { platformName } from "../platform";
import { reportError } from "../report";
import { actions, useVesta, type LinkMenuTarget } from "../store/store";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { linkMenuItems, revealLabel, storedHref } from "./link-menu";

/** The link as HTML for Copy: its text with its address, so a rich paste keeps the link. */
function linkHtml(href: string, text: string): string {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  return a.outerHTML;
}

function write(text: string, html: string | null): void {
  void window.vesta.clipboard.write({ text, html }).then(
    (r) => {
      if (!r.ok) reportError(`link.copy ${r.error.code}`, r.error.message);
    },
    (err: unknown) => {
      reportError("link.copy", err);
    },
  );
}

function reveal(ref: string, name: string): void {
  void window.vesta.assets.reveal({ ref }).then(
    (r) => {
      if (r.ok) return;
      if (r.error.code === "NOT_FOUND") actions.showAssetNotice(t("fileMissing", { n: name }));
      reportError(`link.reveal ${r.error.code}`, r.error.message);
    },
    (err: unknown) => {
      reportError("link.reveal", err);
    },
  );
}

function itemsFor(target: LinkMenuTarget): MenuItem[] {
  const href = storedHref(target.href);
  const kinds = linkMenuItems(href) ?? [];
  const asset = isAssetRef(href);
  return kinds.map((kind): MenuItem => {
    switch (kind) {
      case "copy":
        return { key: kind, label: t("ctxCopy"), icon: null, onSelect: () => { write(target.text, linkHtml(href, target.text)); } };
      case "copyLink":
        return { key: kind, label: t("ctxCopyLink"), icon: null, onSelect: () => { write(href, null); } };
      case "open":
        return { key: kind, label: t("ctxOpenLink"), icon: null, onSelect: () => { openLink(asset ? ASSET_PROTOCOL + href : href, target.text); } };
      case "reveal":
        return { key: kind, label: t(revealLabel(platformName())), icon: null, onSelect: () => { reveal(href, target.text); } };
    }
  });
}

function LinkMenu({ target }: { target: LinkMenuTarget }) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={anchor} className="point-anchor" style={{ left: target.x, top: target.y }} aria-hidden="true" />
      <ContextMenu
        label={t("ctxLinkMenu")}
        items={itemsFor(target)}
        anchorRef={anchor}
        placement="at-point"
        onClose={() => {
          actions.closeLinkMenu();
          if (target.back?.isConnected === true) target.back.focus({ preventScroll: true });
        }}
      />
    </>
  );
}

function UnsafePop({ left, top, back }: { left: number; top: number; back: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => {
      actions.showUnsafeLinkPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && (back.contains(e.target) || ref.current?.contains(e.target) === true)) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", close);
    };
  }, [back]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // Inside the window, 8 px from its edges.
    const x = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8));
    el.style.left = `${String(x)}px`;
    el.style.top = `${String(Math.min(top + 4, window.innerHeight - el.offsetHeight - 8))}px`;
  }, [left, top]);
  return (
    <div ref={ref} className="link-unsafe-pop" role="status">
      {t("linkUnsafe")}
    </div>
  );
}

export function LinkContextMenu() {
  const target = useVesta((s) => s.linkMenu);
  const pop = useVesta((s) => s.unsafeLinkPop);
  return (
    <>
      {target !== null && <LinkMenu key={`${String(target.x)},${String(target.y)},${target.href}`} target={target} />}
      {pop !== null && <UnsafePop left={pop.left} top={pop.top} back={pop.back} />}
    </>
  );
}
