/**
 * 015 License and Third-Party Licenses (FR-028a to FR-030, PRD Q205, Q213; research §11): a view that replaces About in
 * the same window, headed by its name, its text focused on open so the keyboard scrolls it, and the close button as
 * its only control. The third-party notices are THIRD_PARTY_NOTICES.txt, which scripts/third-party-notices.ts writes
 * during `npm run package:*` and the run removes afterwards (017 FR-013); a development build has none, so one line says
 * so.
 */
import { useEffect, useRef } from "react";
import licenseText from "../../../../LICENSE?raw";
import trademarksText from "../../../../TRADEMARKS.md?raw";
import { Close } from "../../components/icons";
import { currentLanguage, t } from "../../i18n/t";

/** `{}` while the file does not exist (FR-029a): every build but a packaged one. */
const notices = import.meta.glob<string>(
  "../../../../THIRD_PARTY_NOTICES.txt",
  { query: "?raw", import: "default", eager: true },
);
const noticesText = Object.values(notices)[0]?.trim() ?? "";

/** 018 FR-024 (PRD Q276): the English notice, the reference wording: TRADEMARKS.md without its heading. */
const trademarkEnglish = trademarksText.replace(/^# [^\n]*\n+/, "").trim();

export function LicenseView({
  view,
  onClose,
}: {
  view: "license" | "thirdParty";
  onClose: () => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    region.current?.focus();
  }, [view]);
  const text =
    view === "license"
      ? licenseText
      : noticesText === ""
        ? t("thirdPartyMissing")
        : noticesText;
  return (
    <>
      <div className="about-bar">
        <button
          type="button"
          className="about-close"
          aria-label={t("aboutClose")}
          title={t("aboutClose")}
          onClick={onClose}
        >
          <Close />
        </button>
      </div>
      <div className="license-view">
        <h2 id="about-h">
          {t(view === "license" ? "aboutLicenseTitle" : "aboutThirdPartyTitle")}
        </h2>
        <div
          ref={region}
          className="about-license-text"
          role="document"
          aria-labelledby="about-h"
          tabIndex={0}
        >
          {/* 018 FR-024 (PRD Q274, Q276): the name and identity notice above the unchanged license, translated first,
              then in English; in English only once. */}
          {view === "license" && currentLanguage() !== "en" && <p className="trademark-local">{t("trademarkNotice")}</p>}
          {view === "license" && <p className="trademark-en">{trademarkEnglish}</p>}
          {text}
        </div>
      </div>
    </>
  );
}
