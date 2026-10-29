// YouTube embeds (FR-034, research §7): the player from youtube-nocookie.com, sandboxed, only while the
// operating system reports a network; otherwise, or when the player has not loaded 10 s after it was shown,
// a placeholder with the link. Nothing about the video is fetched before the player itself.
import { isYoutubeId, youtubeNocookieUrl } from "../../domain/markdown/policy";
import { t } from "../i18n/t";

const LOAD_TIMEOUT_MS = 10_000;

/** Renders the embed for `id` into `container`; returns its cleanup. */
export function mountEmbed(container: HTMLElement, id: string, url: string): () => void {
  // 010 FR-015 (L2): no player without a valid id; the link stays as text.
  if (!isYoutubeId(id)) {
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    container.replaceChildren(link);
    return () => undefined;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const placeholder = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    container.replaceChildren();
    const box = document.createElement("span");
    box.dataset.ytOffline = "";
    const link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    box.append(t("ytPlaceholder", { u: "" }).trimEnd(), " ", link);
    container.append(box);
  };
  const player = () => {
    const frame = document.createElement("iframe");
    frame.src = youtubeNocookieUrl(id);
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("allowfullscreen", "");
    frame.title = url;
    frame.className = "md-yt-frame";
    frame.addEventListener("load", () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    });
    container.replaceChildren(frame);
    timer = setTimeout(placeholder, LOAD_TIMEOUT_MS);
  };
  if (navigator.onLine) player();
  else placeholder();
  window.addEventListener("offline", placeholder);
  return () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("offline", placeholder);
  };
}
