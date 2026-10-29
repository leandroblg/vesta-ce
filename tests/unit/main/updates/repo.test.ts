/** PRD Q292: the release repository is the real one, where the source code of every build is published. */
import { describe, expect, it } from "vitest";
import { RELEASE_REPO, readmeUrl, releasesUrl, sourceUrl } from "../../../../src/main/updates/repo";

describe("release repository (PRD Q292)", () => {
  it("is leandroblg/vesta-ce, never the placeholder", () => {
    expect(RELEASE_REPO).toEqual({ owner: "leandroblg", repo: "vesta-ce" });
    expect(RELEASE_REPO.owner).not.toBe("OWNER");
  });

  it("derives the source, README and releases addresses from it", () => {
    expect(sourceUrl(RELEASE_REPO)).toBe("https://github.com/leandroblg/vesta-ce");
    expect(readmeUrl(RELEASE_REPO)).toBe("https://github.com/leandroblg/vesta-ce#readme");
    expect(releasesUrl(RELEASE_REPO)).toBe("https://api.github.com/repos/leandroblg/vesta-ce/releases?per_page=20");
  });
});
