/** The language choice (007 FR-013 to FR-017): Use system language, then each language in its own name. */
import { LANGS, isLanguageSetting } from "../../../domain/language";
import { RESOURCES } from "../../../shared/i18n";
import { t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

export function LanguageSelect() {
  const setting = useVesta((s) => s.languageSetting);
  return (
    <div className="srow">
      <div className="srow-l">
        <label htmlFor="set-language">{t("language")}</label>
      </div>
      <div className="srow-c">
        <select
          id="set-language"
          className="sel"
          value={setting}
          onChange={(e) => {
            const next = e.target.value;
            if (isLanguageSetting(next)) void actions.setLanguageSetting(next);
          }}
        >
          <option value="system">{t("useSystemLanguage")}</option>
          {LANGS.map((lang) => (
            // The endonym from the language's own file, the same in every UI language (CHK003).
            <option key={lang} value={lang} lang={lang}>
              {RESOURCES[lang]["langName"]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
