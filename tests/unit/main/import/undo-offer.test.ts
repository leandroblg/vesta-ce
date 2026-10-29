// T044: the Undo import offer in main (research §6; FR-037a to FR-037c), on the app clock.
import { describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../../src/domain/clock";
import { UNDO_IMPORT_MS, UndoImportOffer } from "../../../../src/main/import/undo-offer";

function fakeTimer() {
  let fn: (() => void) | null = null;
  return {
    timer: {
      setInterval: (f: () => void) => {
        fn = f;
        return 1;
      },
      clearInterval: () => {
        fn = null;
      },
    },
    fire: () => fn?.(),
    active: () => fn !== null,
  };
}

describe("UndoImportOffer", () => {
  it("lasts 60 s on the app clock and ends once at the deadline", () => {
    const clock = fakeClock(1_000);
    const t = fakeTimer();
    const onEnd = vi.fn();
    const offer = new UndoImportOffer(clock, t.timer, () => "tok");
    expect(UNDO_IMPORT_MS).toBe(60_000);
    expect(offer.start(onEnd)).toEqual({ token: "tok", deadline: 61_000 });
    expect(offer.current()).toEqual({ token: "tok", deadline: 61_000 });
    clock.advance(59_999);
    t.fire();
    expect(onEnd).not.toHaveBeenCalled();
    clock.advance(1);
    t.fire();
    t.fire();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(offer.current()).toBeNull();
    expect(t.active()).toBe(false);
  });

  it("ends early on end(), only once", () => {
    const clock = fakeClock(0);
    const t = fakeTimer();
    const onEnd = vi.fn();
    const offer = new UndoImportOffer(clock, t.timer, () => "tok");
    offer.start(onEnd);
    offer.end();
    offer.end();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(t.active()).toBe(false);
  });

  it("accepts only the current token before the deadline", () => {
    const clock = fakeClock(0);
    const t = fakeTimer();
    const offer = new UndoImportOffer(clock, t.timer, () => "tok");
    expect(offer.isValid("tok")).toBe(false);
    offer.start(() => undefined);
    expect(offer.isValid("tok")).toBe(true);
    expect(offer.isValid("other")).toBe(false);
    clock.advance(60_000);
    expect(offer.isValid("tok")).toBe(false);
  });
});
