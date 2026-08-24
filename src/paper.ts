/**
 * レポート用紙(ノート)風の背景。呼び出し側であらかじめ円のクリップを設定し、
 * 円の中心を原点にtranslate済みのコンテキストに対して呼ぶこと。
 */

const PAPER_WHITE = "#ffffff";
const RULE_LINE = "oklch(78% 0.07 240 / 0.4)";

/** 罫線の間隔を決める分割数（半径1単位をこの数で割った間隔で線を引く）。 */
const RULE_LINE_DIVISIONS = 7;

/**
 * @param radius 罫線の間隔・太さの基準（正規化1単位=半径1に対応するpx）。
 * @param fillHalfExtent 実際に紙面を塗り広げる半径（省略時はradiusと同じ）。
 *   Oval/Squareのように、クリップ境界がradius基準の正方形（-radius..radius）
 *   より外まで張り出す形状では、これを大きめに渡さないと紙の外側（クリップ
 *   境界の内側だが正方形の外側）が塗られず背景色のまま透けて見えてしまう
 *   ——罫線の間隔・太さの基準はradiusのまま据え置き、塗る範囲だけを広げる。
 */
export function drawRuledPaper(
  ctx: CanvasRenderingContext2D,
  radius: number,
  fillHalfExtent: number = radius
): void {
  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(-fillHalfExtent, -fillHalfExtent, fillHalfExtent * 2, fillHalfExtent * 2);

  const spacing = radius / RULE_LINE_DIVISIONS;
  ctx.strokeStyle = RULE_LINE;
  ctx.lineWidth = Math.max(1, radius / 300);
  for (let y = -fillHalfExtent; y <= fillHalfExtent; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(-fillHalfExtent, y);
    ctx.lineTo(fillHalfExtent, y);
    ctx.stroke();
  }
}
