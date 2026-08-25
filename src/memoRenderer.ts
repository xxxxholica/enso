import { fontPxForRender, LINE_HEIGHT_MULTIPLIER, TEXT_FONT_FAMILY } from "./textLayout";
import { toolRenderStyle } from "./toolStyle";
import type { Memo } from "./types";

const HEAT_GLOW_COLOR = "oklch(70% 0.18 35 / 0.45)";
const HEAT_GLOW_MAX_RADIUS_PX = 60;

/**
 * 中心(cx, cy)・半径radiusPxの放射グラデーションの円を描く共通ヘルパー。
 * なぞり中/移動中のかすかなグロー（canvasView.ts）と、投票フェーズの熱量グロー
 * （renderHeatGlow）が同じ「中心から色→透明へのグラデーションの円」という
 * 描き方を共有するため、ここに1つだけ持つ。
 */
export function drawRadialGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  color: string
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "transparent");
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 共同アイデア出しの投票フェーズ(voting)中、およびフェーズ終了後(fadeExempt)に、
 * メモの相対密度(0..1)を暖色のグローとして描画する。relativeDensityが0以下
 * なら何も描かない。
 */
export function renderHeatGlow(
  ctx: CanvasRenderingContext2D,
  memo: Memo,
  radius: number,
  relativeDensity: number
): void {
  if (relativeDensity <= 0) return;
  drawRadialGlow(ctx, memo.x * radius, memo.y * radius, HEAT_GLOW_MAX_RADIUS_PX * Math.min(1, relativeDensity), HEAT_GLOW_COLOR);
}

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
    const style = toolRenderStyle(memo.tool, radius, memo.lineWidth);
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
  ctx.textBaseline = "middle";
  const lineHeight = fontPx * (memo.lineHeight ?? LINE_HEIGHT_MULTIPLIER);
  const totalHeight = memo.textLines.length * lineHeight;
  let ly = memo.y * radius - totalHeight / 2 + lineHeight / 2;
  // 持ち物チェックのテンプレートのように行ごとに幅が違う文面は、中央揃えだと左端がガタつくため
  // 左揃えにできる（align省略時・既存データは中央揃えのまま）。
  const isLeft = memo.align === "left";
  ctx.textAlign = isLeft ? "left" : "center";
  const lx = isLeft ? (memo.x - memo.boxWidth / 2) * radius : memo.x * radius;
  for (const line of memo.textLines) {
    ctx.fillText(line, lx, ly);
    ly += lineHeight;
  }
}
