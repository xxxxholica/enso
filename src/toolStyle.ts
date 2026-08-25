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
 * ペンの太さ（基準円=半径340pxでのpx値）のスライダーの範囲。以前は文字サイズ
 * （小・中・大）と同じステッパーを共有していたが、GoodNotesのようにバーで
 * 連続的に選べるようにしたいというユーザー指示により、文字サイズとは独立した
 * 専用のスライダーに分けた（toolbar.tsのbuildThicknessSlider参照）。
 * defaultの3pxは、以前のステッパーの「中」と同じ値。
 */
export const PEN_WIDTH_RANGE = { min: 1, max: 10, step: 0.5, default: 3 } as const;

/** マーカーの太さ（基準円=半径340pxでのpx値、固定・調整不可）。以前は15pxで
 *  実際の画面上では太すぎるとの指摘（体感で約6px相当）があったため、体感で
 *  4〜5px程度になるよう約3分の2の11pxへ縮小した（ユーザー指示）。 */
const MARKER_LINE_WIDTH = 11;

function baseStyle(tool: DrawTool, penLineWidth: number): ToolRenderStyle {
  switch (tool) {
    case "marker":
      return { lineWidth: MARKER_LINE_WIDTH, alphaMultiplier: 0.4, composite: "multiply" };
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
 * スライダーのdefault相当にフォールバックする。マーカーには使わない。
 */
export function toolRenderStyle(
  tool: DrawTool,
  radius: number = REFERENCE_RADIUS,
  penLineWidthAtReference: number = PEN_WIDTH_RANGE.default
): ToolRenderStyle {
  const base = baseStyle(tool, penLineWidthAtReference);
  const scale = radius / REFERENCE_RADIUS;
  return { ...base, lineWidth: Math.max(1, base.lineWidth * scale) };
}
