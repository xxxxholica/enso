import type { BoardShape } from "./boardShape";
import type { Point } from "./types";

/** キャンバスの縦方向（px）の下限・上限。極端に小さい/大きいウィンドウでも破綻しないように。
 *  通常キャンバスと振り返りのプレビューキャンバスの両方がこの定数を共有することで、
 *  「同じ大きさ」を保証する。 */
export const MIN_CANVAS_SIZE = 200;
/** 以前は900だったが、上部のタイトル表示を廃止して画面切り替えを下部の操作パネルに
 *  統合したことで縦方向の余白が増えたため、盤面をさらに大きく見せられるよう引き上げた。 */
export const MAX_CANVAS_SIZE = 1100;

export interface CanvasGeometry {
  width: number;
  height: number;
  /** px per 正規化単位（旧・円の半径px）。図形が円以外でもこの一つのスケール値で
   *  すべての描画・当たり判定の px⇄正規化座標 変換ができる。 */
  scale: number;
  centerPx: Point;
}

/**
 * コンテナの利用可能な幅・高さいっぱいまで、盤面の形（円・眼鏡など）の
 * バウンディングボックスの縦横比を保って広げ、縦方向の大きさに上下限だけ設ける。
 * canvas要素の実サイズ（style幅高さ・描画バッファ）をこのタイミングで適用し、
 * 以後の座標計算に使うスケール・中心を返す。
 */
export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number,
  shape: BoardShape
): CanvasGeometry {
  const rect = container.getBoundingClientRect();
  const aspect = shape.halfWidth / shape.halfHeight;
  const availableW = rect.width;
  const availableH = rect.height || rect.width;
  const heightLimit = Math.min(availableH, availableW / aspect);
  const size = Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, heightLimit));
  const scale = (size * 0.43) / shape.halfHeight;
  const width = size * aspect;
  const height = size;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  return { width, height, scale, centerPx: { x: width / 2, y: height / 2 } };
}
