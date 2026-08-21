import { fontPxForRender, LINE_HEIGHT_MULTIPLIER, TEXT_FONT_FAMILY } from "./textLayout";
import { toolRenderStyle } from "./toolStyle";
import type { Memo } from "./types";

/**
 * 1つのメモを円のローカル座標系（中心が原点、半径がradius px）に描画する。
 * 呼び出し側であらかじめ円の中心へtranslate済みのコンテキストに対して呼ぶこと。
 * 手描き(stroke)とテキスト(text)の両方に対応し、メインキャンバス・振り返りの
 * タイムラインプレビューの両方から共通で使う（見た目を一致させるため）。
 */
export function renderMemoAt(
  ctx: CanvasRenderingContext2D,
  memo: Memo,
  radius: number,
  opacity: number
): void {
  if (memo.kind === "stroke") {
    const style = toolRenderStyle(memo.tool, radius);
    ctx.globalAlpha = opacity * style.alphaMultiplier;
    ctx.globalCompositeOperation = style.composite;
    ctx.strokeStyle = memo.color;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of memo.strokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * radius, stroke[0].y * radius);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x * radius, stroke[i].y * radius);
      }
      ctx.stroke();
    }
    return;
  }

  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = memo.color;
  const fontPx = fontPxForRender(memo.fontSize, radius);
  ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = fontPx * LINE_HEIGHT_MULTIPLIER;
  const totalHeight = memo.textLines.length * lineHeight;
  let ly = memo.y * radius - totalHeight / 2 + lineHeight / 2;
  for (const line of memo.textLines) {
    ctx.fillText(line, memo.x * radius, ly);
    ly += lineHeight;
  }
}
