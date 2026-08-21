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

function baseStyle(tool: DrawTool): ToolRenderStyle {
  switch (tool) {
    case "pencil":
      return { lineWidth: 2, alphaMultiplier: 0.8, composite: "source-over" };
    case "marker":
      return { lineWidth: 15, alphaMultiplier: 0.4, composite: "multiply" };
    case "pen":
    default:
      return { lineWidth: 3, alphaMultiplier: 1, composite: "source-over" };
  }
}

/**
 * ツールごとの見た目（太さ・不透明度の質感・合成方法）。
 * 鉛筆＝細くやや薄い、ペン＝標準、マーカー＝太く半透明で下地と重なるように乗算合成する。
 * radiusを渡すと、その円の大きさに比例して線の太さをスケールする
 * （メインキャンバスと、振り返りのサムネイル／タイムラインプレビューのように
 * サイズが大きく異なる場所で、線の相対的な太さの見た目を揃えるため）。
 */
export function toolRenderStyle(tool: DrawTool, radius: number = REFERENCE_RADIUS): ToolRenderStyle {
  const base = baseStyle(tool);
  const scale = radius / REFERENCE_RADIUS;
  return { ...base, lineWidth: Math.max(1, base.lineWidth * scale) };
}
