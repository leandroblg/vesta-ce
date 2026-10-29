/**
 * The toolbar search (006 FR-001, FR-002, FR-016, FR-020, FR-022, FR-023; HIG identity review, B · Hearth):
 * the centered field with its clear button and a Search options button, and a scope bar under the toolbar that
 * shows while a search is active or the options are open. 013 FR-036 to FR-038 (PRD Q166): the bar reads "Search
 * in:", an Active / Everything choice (Everything adds the Archive and the Trash), the Match case and Exact phrase
 * checkboxes, and the result count at its right end.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { Close, Filter, Search } from "../../components/icons";
import { t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

export const SEARCH_INPUT_ID = "search";
/** The channel's limit (006 contracts/ipc.md). */
const MAX_TEXT = 10_000;

function ResultCount() {
  const active = useVesta((s) => s.search.active && s.search.session.applied);
  const n = useVesta((s) => s.search.session.matches.size);
  const slow = useVesta((s) => s.search.active && s.search.session.slow);
  if (!active && !slow) return null;
  // "Preparing search…" while the index fills (FR-025); then the count, as the announcer says it (FR-023).
  if (slow) return <span className="search-status">{t("searchPreparing")}</span>;
  return <span className="search-count">{n === 0 ? t("resultsNone") : t("results", { count: n })}</span>;
}

/** 013 FR-036, FR-038: one group of two options, Active or Everything; the arrow keys move between them and select. */
function ScopeChoice({ everything }: { everything: boolean }) {
  const group = useRef<HTMLDivElement>(null);
  const pick = (on: boolean) => {
    if (on !== everything) actions.setIncludeArchiveTrash(on);
    group.current?.querySelector<HTMLElement>(`[data-scope="${on ? "everything" : "active"}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    pick(!everything);
  };
  const option = (on: boolean, label: string) => (
    <button
      type="button"
      role="radio"
      data-scope={on ? "everything" : "active"}
      aria-checked={everything === on}
      tabIndex={everything === on ? 0 : -1}
      onClick={() => {
        pick(on);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="seg" role="radiogroup" aria-labelledby="search-in" ref={group} onKeyDown={onKeyDown}>
      {option(false, t("scopeActive"))}
      {option(true, t("scopeEverything"))}
    </div>
  );
}

export function SearchBox() {
  const text = useVesta((s) => s.search.text);
  const active = useVesta((s) => s.search.active);
  const matchCase = useVesta((s) => s.search.matchCase);
  const exactPhrase = useVesta((s) => s.search.exactPhrase);
  const includeArchiveTrash = useVesta((s) => s.search.includeArchiveTrash);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scopeShown = optionsOpen || active;
  return (
    <div className="search">
      <div className="search-box">
        <Search />
        <input
          ref={input}
          id={SEARCH_INPUT_ID}
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_TEXT}
          placeholder={t("searchPh")}
          aria-label={t("searchPh")}
          value={text}
          onChange={(e) => {
            actions.setSearchText(e.target.value);
          }}
          onKeyDown={(e) => {
            // FR-022: Esc clears the search and keeps focus; on an empty box it acts as elsewhere.
            if (e.key === "Escape" && text !== "") {
              e.preventDefault();
              e.stopPropagation();
              actions.clearSearch();
            }
          }}
        />
        <div className="search-tools">
          {text !== "" && (
            <button
              type="button"
              className="search-tool clear"
              aria-label={t("clearSearch")}
              title={t("clearSearch")}
              onClick={() => {
                actions.clearSearch();
                input.current?.focus();
              }}
            >
              <Close />
            </button>
          )}
          <button
            type="button"
            className="search-tool filter"
            aria-pressed={scopeShown}
            aria-controls="search-scope"
            aria-label={t("searchOptions")}
            title={t("searchOptions")}
            onClick={() => {
              setOptionsOpen(!scopeShown);
            }}
          >
            <Filter />
          </button>
        </div>
      </div>
      <div className="search-scope" id="search-scope" hidden={!scopeShown}>
        <span className="scope-label" id="search-in">
          {t("searchIn")}
        </span>
        <ScopeChoice everything={includeArchiveTrash} />
        <label className="chk">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={() => {
              actions.toggleMatchCase();
            }}
          />
          <span>{t("matchCase")}</span>
        </label>
        <label className="chk">
          <input
            type="checkbox"
            checked={exactPhrase}
            onChange={() => {
              actions.toggleExactPhrase();
            }}
          />
          <span>{t("exactPhrase")}</span>
        </label>
        <ResultCount />
      </div>
    </div>
  );
}
