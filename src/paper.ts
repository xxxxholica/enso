/**
 * レポート用紙(ノート)風の背景。呼び出し側であらかじめ円のクリップを設定し、
 * 円の中心を原点にtranslate済みのコンテキストに対して呼ぶこと。
 */

const PAPER_WHITE = "#ffffff";
const RULE_LINE = "oklch(78% 0.07 240 / 0.4)";

export interface RuledPaperOptions {
  /** 横罫線を引くか（既定: true） */
  lines?: boolean;
}

export function drawRuledPaper(
  ctx: CanvasRenderingContext2D,
  radius: number,
  opts: RuledPaperOptions = {}
): void {
  const { lines = true } = opts;

  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

  if (lines) {
    const spacing = radius / 7;
    ctx.strokeStyle = RULE_LINE;
    ctx.lineWidth = Math.max(1, radius / 300);
    for (let y = -radius; y <= radius; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(-radius, y);
      ctx.lineTo(radius, y);
      ctx.stroke();
    }
  }
}
