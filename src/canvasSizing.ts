import type { Point } from "./types";

/** キャンバスの一辺（px）の下限・上限。極端に小さい/大きいウィンドウでも破綻しないように。
 *  通常キャンバスと振り返りのプレビューキャンバスの両方がこの定数を共有することで、
 *  「同じ大きさ」を保証する。 */
export const MIN_CANVAS_SIZE = 200;
/** 以前は900だったが、上部のタイトル表示を廃止して画面切り替えを下部の操作パネルに
 *  統合したことで縦方向の余白が増えたため、円をさらに大きく見せられるよう引き上げた。 */
export const MAX_CANVAS_SIZE = 1100;

export interface CanvasGeometry {
  size: number;
  radius: number;
  centerPx: Point;
}

/**
 * コンテナの利用可能な幅・高さのうち小さい方いっぱいまで正方形として広げ、
 * 上下限だけ設ける。canvas要素の実サイズ（style幅高さ・描画バッファ）を
 * このタイミングで適用し、以後の座標計算に使う半径・中心を返す。
 */
export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number
): CanvasGeometry {
  const rect = container.getBoundingClientRect();
  const available = Math.min(rect.width, rect.height || rect.width);
  const size = Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, available));
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  return { size, radius: size * 0.43, centerPx: { x: size / 2, y: size / 2 } };
}
