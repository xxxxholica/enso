import { REFERENCE_RADIUS } from "./toolStyle";

/** テキストに使うフォント。手描きの世界観に合わせ、他の文字と同じ書体にする。 */
export const TEXT_FONT_FAMILY = "'Klee One', 'Noto Sans JP', sans-serif";

/** 折り返し幅（基準円=半径340pxでのpx値）。テキストメモの正規化boxWidthはこれをREFERENCE_RADIUSで割った値になる。 */
export const REFERENCE_TEXT_BOX_WIDTH_PX = 240;

/** 行の高さ（フォントサイズに対する倍率）。 */
export const LINE_HEIGHT_MULTIPLIER = 1.4;

/**
 * 実際に描画するフォントサイズ(px)の下限。円がどれだけ小さいウィンドウで
 * 表示されていても、あるいはユーザーが「小」を選んでいても、これより
 * 小さくは描画しない（読めなくなることを防ぐための下限設定）。
 */
export const MIN_FONT_PX = 12;

/** 文字サイズの選択肢。値は基準円(半径340px)におけるフォントサイズ(px)。 */
export const FONT_SIZE_STEPS = { small: 18, medium: 24, large: 32 } as const;
export type FontSizeStep = keyof typeof FONT_SIZE_STEPS;
export const DEFAULT_FONT_SIZE_STEP: FontSizeStep = "medium";

/**
 * 実際の描画半径に応じたフォントサイズ(px)を計算する。線の太さ(toolStyle.ts)と
 * 同じ考え方で、基準円に対する比率でスケールしつつ、下限(MIN_FONT_PX)を必ず守る。
 */
export function fontPxForRender(fontPxAtReference: number, radius: number): number {
  return Math.max(MIN_FONT_PX, fontPxAtReference * (radius / REFERENCE_RADIUS));
}

function wrapParagraphs(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    // 日本語には単語間のスペースがないため、1文字ずつ詰めて幅で折り返す
    // （英単語の途中で折り返される場合があるが、手書きメモの短い文章という
    //   用途では厳密なタイポグラフィよりも実装のシンプルさを優先した）。
    let current = "";
    for (const ch of para) {
      const test = current + ch;
      if (current !== "" && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines;
}

/**
 * テキストを、基準円(半径REFERENCE_RADIUS)における折り返し幅(REFERENCE_TEXT_BOX_WIDTH_PX)で
 * 行分割する。実際の描画半径やユーザーが選んだ文字サイズに関わらず、常にこの基準サイズで
 * 測定することで、リサイズしても行分割の結果（＝改行位置）が変わらないようにする
 * （フォントサイズも折り返し幅も同じ比率で実際の半径にスケールするため、
 *   基準サイズでの折り返し結果はどの半径でもそのまま正しく使い回せる）。
 */
export function wrapTextAtReferenceScale(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPxAtReference: number
): string[] {
  const prevFont = ctx.font;
  ctx.font = `${fontPxAtReference}px ${TEXT_FONT_FAMILY}`;
  const lines = wrapParagraphs(ctx, text, REFERENCE_TEXT_BOX_WIDTH_PX);
  ctx.font = prevFont;
  return lines.length > 0 ? lines : [""];
}

/** テキストブロックの折り返し幅・高さを、円の半径を1とする正規化単位で返す。 */
export function normalizedBoxSize(
  fontPxAtReference: number,
  lineCount: number
): { width: number; height: number } {
  const width = REFERENCE_TEXT_BOX_WIDTH_PX / REFERENCE_RADIUS;
  const lineHeightPx = fontPxAtReference * LINE_HEIGHT_MULTIPLIER;
  const height = (lineCount * lineHeightPx) / REFERENCE_RADIUS;
  return { width, height };
}
