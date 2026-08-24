/**
 * チュートリアル専用の、本物のfade.tsとは独立したフェード計算。
 * 実装（fade.ts）は振り返り機構と合わせてバックグラウンドで改修中のため
 * importしない。本物は1/0.6/0.2/0の4段階だが、体験としては段差が
 * 「アニメーションしていないように見える」ため、なめらかに連続変化する
 * カーブにする（ユーザー指摘）。また、体験中は完全には消さない
 * （ユーザー指摘：③でつまむ対象が見えなくなってしまうため、TUTORIAL_FADE_FLOOR
 * までしか薄くならない）。
 */

/** 体験用の、薄くなりきるまでの時間。 */
export const TUTORIAL_LIFESPAN_MS = 2600;

/** どれだけ薄くなっても、これより下には薄くならない（完全には消えない）。 */
export const TUTORIAL_FADE_FLOOR = 0.16;

export function tutorialOpacity(elapsedMs: number, lifespanMs: number): number {
  if (elapsedMs <= 0) return 1;
  const t = Math.min(elapsedMs / lifespanMs, 1);
  const eased = 1 - (1 - t) * (1 - t); // ease-out：はじめは速く、後半はゆっくり薄くなる
  return 1 - eased * (1 - TUTORIAL_FADE_FLOOR);
}
