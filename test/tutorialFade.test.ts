import { describe, expect, it } from "vitest";
import { TUTORIAL_FADE_FLOOR, TUTORIAL_LIFESPAN_MS, tutorialOpacity } from "../src/tutorial/tutorialFade";

describe("tutorialOpacity（本物のfade.tsから独立した、体験用のなめらかなフェード）", () => {
  const L = TUTORIAL_LIFESPAN_MS;

  it("経過0（またはそれ以前）は100%", () => {
    expect(tutorialOpacity(0, L)).toBe(1);
    expect(tutorialOpacity(-1, L)).toBe(1);
  });

  it("時間の経過とともに連続的に薄くなる（途中で段差がない）", () => {
    const a = tutorialOpacity(L * 0.2, L);
    const b = tutorialOpacity(L * 0.5, L);
    const c = tutorialOpacity(L * 0.8, L);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(TUTORIAL_FADE_FLOOR);
  });

  it("寿命に達しても、下限（TUTORIAL_FADE_FLOOR）より下には薄くならない", () => {
    expect(tutorialOpacity(L, L)).toBeCloseTo(TUTORIAL_FADE_FLOOR, 5);
    expect(tutorialOpacity(L * 10, L)).toBeCloseTo(TUTORIAL_FADE_FLOOR, 5);
  });
});
