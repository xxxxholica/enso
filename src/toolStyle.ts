import type { FontSizeStep } from "./textLayout";
import type { DrawTool } from "./types";

export interface ToolRenderStyle {
  lineWidth: number;
  /** フェードで決まる不透明度に、さらに掛け合わせる質感由来の係数 */
  alphaMultiplier: number;
  composite: GlobalCompositeOperation;
}

/** 太さ・文字サイズの基準値を決めている円の半径(px)。メインキャンバスの中庸なサイズを基準にした値。
 *  textLayout.tsのフォントサイズ・折り返し幅もこの値を基準にしており、
 *  線の太さと文字の大きさの相対的なスケール感を統一している。 */
export const REFERENCE_RADIUS = 340;

/**
 * ペンの線の太さ（基準円=半径340pxでのpx値）の選択肢。文字サイズ
 * （textLayout.FONT_SIZE_STEPS）と同じ小・中・大のステッパーを共有する
 * ——以前は鉛筆／ペンで固定の太さ(2px/3px)を使い分けていたが、2つを1つの
 * ペンに統合したのに合わせて、ステッパーで太さを選べるようにした
 * （ユーザー指示）。mediumの3pxは、統合前のペンの太さと同じ値。
 */
export const PEN_WIDTH_STEPS: Record<FontSizeStep, number> = { small: 1.5, medium: 3, large: 6 };

function baseStyle(tool: DrawTool, penLineWidth: number): ToolRenderStyle {
  switch (tool) {
    case "marker":
      return { lineWidth: 15, alphaMultiplier: 0.4, composite: "multiply" };
    case "pen":
    default:
      return { lineWidth: penLineWidth, alphaMultiplier: 1, composite: "source-over" };
  }
}

/**
 * ツールごとの見た目（太さ・不透明度の質感・合成方法）。
 * ペン＝標準（太さはpenLineWidthAtReferenceで可変）、マーカー＝太く半透明で
 * 下地と重なるように乗算合成する。
 * radiusを渡すと、その円の大きさに比例して線の太さをスケールする
 * （メインキャンバスと、振り返りのサムネイル／タイムラインプレビューのように
 * サイズが大きく異なる場所で、線の相対的な太さの見た目を揃えるため）。
 * penLineWidthAtReferenceは、そのペンのストロークが作られた時点で選ばれていた
 * 太さ（StrokeMemo.lineWidth）を渡す想定——省略時（旧バージョンのデータなど）は
 * 「中」相当にフォールバックする。マーカーには使わない。
 */
export function toolRenderStyle(
  tool: DrawTool,
  radius: number = REFERENCE_RADIUS,
  penLineWidthAtReference: number = PEN_WIDTH_STEPS.medium
): ToolRenderStyle {
  const base = baseStyle(tool, penLineWidthAtReference);
  const scale = radius / REFERENCE_RADIUS;
  return { ...base, lineWidth: Math.max(1, base.lineWidth * scale) };
}
