/** 018 FR-020d: the renderer clock, re-rendering every second while `active` (a countdown on screen). */
import { useEffect, useState } from "react";
import { rendererClock } from "../clock";

export function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => rendererClock.now());
  useEffect(() => {
    if (!active) return;
    setNow(rendererClock.now());
    const handle = setInterval(() => {
      setNow(rendererClock.now());
    }, 1000);
    return () => {
      clearInterval(handle);
    };
  }, [active]);
  return active ? now : rendererClock.now();
}
