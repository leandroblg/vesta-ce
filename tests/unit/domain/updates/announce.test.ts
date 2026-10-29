import { describe, expect, it } from "vitest";
import { decideAnnouncement, markShows } from "../../../../src/domain/updates/announce";

describe("announcing a newer version (009 FR-024, FR-024a; research §10)", () => {
  it("announces a new version found while Settings is closed: notice, mark, stored unseen", () => {
    expect(decideAnnouncement(null, "0.2.0", "0.1.0", false)).toEqual({ notify: true, store: { version: "0.2.0", seen: false } });
  });

  it("does not announce the same version twice, in this session or after a restart", () => {
    expect(decideAnnouncement({ version: "0.2.0", seen: false }, "0.2.0", "0.1.0", false)).toEqual({ notify: false, store: null });
    expect(decideAnnouncement({ version: "0.2.0", seen: true }, "0.2.0", "0.1.0", false)).toEqual({ notify: false, store: null });
  });

  it("announces a still newer version again", () => {
    expect(decideAnnouncement({ version: "0.2.0", seen: true }, "0.3.0", "0.1.0", false)).toEqual({ notify: true, store: { version: "0.3.0", seen: false } });
  });

  it("found while Settings is open: stored as seen, no notice, no mark", () => {
    expect(decideAnnouncement(null, "0.2.0", "0.1.0", true)).toEqual({ notify: false, store: { version: "0.2.0", seen: true } });
  });

  it("never announces a version that is not newer than the running one", () => {
    expect(decideAnnouncement(null, "0.1.0", "0.1.0", false)).toEqual({ notify: false, store: null });
  });

  it("shows the mark only for an unseen version newer than the running one", () => {
    expect(markShows({ version: "0.2.0", seen: false }, "0.1.0")).toBe(true);
    expect(markShows({ version: "0.2.0", seen: true }, "0.1.0")).toBe(false);
    expect(markShows({ version: "0.2.0", seen: false }, "0.2.0")).toBe(false);
    expect(markShows({ version: "0.2.0", seen: false }, "0.3.0")).toBe(false);
    expect(markShows(null, "0.1.0")).toBe(false);
  });
});

describe("013 FR-024 the Updates pane", () => {
  it("FR-024 a version found while the Updates pane is shown is seen, with no notice", () => {
    expect(decideAnnouncement(null, "0.3.0", "0.2.0", true)).toEqual({ notify: false, store: { version: "0.3.0", seen: true } });
    expect(decideAnnouncement(null, "0.3.0", "0.2.0", false)).toEqual({ notify: true, store: { version: "0.3.0", seen: false } });
  });
});
