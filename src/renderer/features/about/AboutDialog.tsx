/**
 * About Vesta (013 FR-027 to FR-031, PRD Q168, Q178; research §7; contracts/ui.md "About window"): Vesta's own
 * window in the macOS About style on every platform, modal to the main window, drawn as the prototype's About Vesta
 * frame. Its only controls are License, Third-Party Licenses and the close button (015 FR-028); each license button
 * replaces About with its own view in the same window, whose Esc or close brings About back (FR-030).
 */
import { useEffect, useRef } from "react";
import { AppIcon, Close } from "../../components/icons";
import { t } from "../../i18n/t";
import { actions, useVesta, type AboutView } from "../../store/store";
import { LicenseView } from "./LicenseView";

/** The element that had the focus when About opened, given it back on close (FR-030). */
let opener: HTMLElement | null = null;

function restoreFocus(): void {
  const back = opener;
  opener = null;
  if (back?.isConnected === true) back.focus();
  else document.querySelector<HTMLElement>("[data-list] li[data-id]")?.focus();
}

export function AboutDialog() {
  const open = useVesta((s) => s.aboutOpen);
  const view = useVesta((s) => s.aboutView);
  const version = useVesta((s) => s.appVersion);
  const isMac = useVesta((s) => s.isMac);
  useVesta((s) => s.language);
  const dialog = useRef<HTMLDialogElement>(null);
  const licenseButton = useRef<HTMLButtonElement>(null);
  const thirdPartyButton = useRef<HTMLButtonElement>(null);
  const shown = useRef<AboutView>("about");

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) {
      opener =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : null;
      d.showModal();
      licenseButton.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // FR-030: back on About, the focus goes to the button that opened the view just closed.
  useEffect(() => {
    if (!open) return;
    if (view === "about" && shown.current !== "about")
      (shown.current === "license"
        ? licenseButton
        : thirdPartyButton
      ).current?.focus();
    shown.current = view;
  }, [open, view]);

  function onCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    // Esc: a license view returns to About first, then About closes (FR-030).
    e.preventDefault();
    if (useVesta.getState().aboutView !== "about") actions.closeLicense();
    else actions.closeAbout();
  }

  function onClose() {
    // The close event comes a task after close(): About reopened in between is open again, and this event is stale.
    if (dialog.current?.open === true) return;
    if (useVesta.getState().aboutOpen) actions.closeAbout();
    restoreFocus();
  }

  return (
    <dialog
      ref={dialog}
      className={view === "about" ? "about-dialog" : "about-dialog license"}
      aria-labelledby="about-h"
      onCancel={onCancel}
      onClose={onClose}
      data-testid="about-dialog"
    >
      {view !== "about" ? (
        <LicenseView
          view={view}
          onClose={() => {
            actions.closeLicense();
          }}
        />
      ) : (
        <>
          <div className="about-bar">
            <button
              type="button"
              className="about-close"
              aria-label={t("aboutClose")}
              title={t("aboutClose")}
              onClick={() => {
                actions.closeAbout();
              }}
            >
              <Close />
            </button>
          </div>
          <h2 id="about-h" className="sr-only">
            {t("aboutTitle")}
          </h2>
          <div className="about-card">
            <AppIcon size={96} />
            {/* 018 FR-002 (PRD Q270, Q284): the superscript, and the edition written out under the wordmark. */}
            <div className="wordmark">
              {t("appName")}
              <sup className="ed" aria-hidden="true">
                {t("editionMark")}
              </sup>
            </div>
            <div className="about-edition">{t("editionLine")}</div>
            <div className="about-version">
              {t("aboutVersion", { v: version })}
            </div>
            <p className="tagline">{t("tagline")}</p>
            <p className="note about-text">
              {t(isMac ? "aboutTextMac" : "aboutTextOther")}
            </p>
            {/* FR-028a: License first, Third-Party Licenses second, side by side; neither is a default button. */}
            <div className="about-buttons">
              <button
                ref={licenseButton}
                type="button"
                className="btn"
                onClick={() => {
                  actions.showLicense("license");
                }}
              >
                {t("aboutLicenseButton")}
              </button>
              <button
                ref={thirdPartyButton}
                type="button"
                className="btn"
                onClick={() => {
                  actions.showLicense("thirdParty");
                }}
              >
                {t("aboutThirdParty")}
              </button>
            </div>
            <p className="note about-footnote">{t("aboutFootnote")}</p>
            {/* 018 FR-023 (PRD Q274): the name and identity are reserved, outside the license. */}
            <p className="note about-footnote about-trademark">{t("aboutTrademark")}</p>
          </div>
        </>
      )}
    </dialog>
  );
}
