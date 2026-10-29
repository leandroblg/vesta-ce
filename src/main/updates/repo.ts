/**
 * The repository the update check reads (009 FR-021, FR-022) and where the source code is published (PRD Q292):
 * https://github.com/leandroblg/vesta-ce. Set on 2026-10-27, replacing the OWNER/vesta placeholder of feature 009;
 * tests never depend on it, because they use the fixture transport.
 */
import type { RepoRef } from "../../domain/updates/releases";

export const RELEASE_REPO: RepoRef = Object.freeze({ owner: "leandroblg", repo: "vesta-ce" });

/** PRD Q292: the public repository that holds the source code of every build. */
export const sourceUrl = (repo: RepoRef): string => `https://github.com/${repo.owner}/${repo.repo}`;

/** The one update address on the allow-list (FR-022). */
export const releasesUrl = (repo: RepoRef): string => `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=20`;
export const releasesPrefix = (repo: RepoRef): string => `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases`;

/** 013 FR-008: Vesta Help, the project's README in the browser. */
export const readmeUrl = (repo: RepoRef): string => `https://github.com/${repo.owner}/${repo.repo}#readme`;
/** 013 FR-008: Release Notes, the release page of the installed version. */
export const releaseTagUrl = (repo: RepoRef, version: string): string =>
  `https://github.com/${repo.owner}/${repo.repo}/releases/tag/v${encodeURIComponent(version)}`;
