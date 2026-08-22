import type { Point } from "./types";

/** キャンバスの一辺（px）の下限・上限。極端に小さい/大きいウィンドウでも破綻しないように。
 *  通常キャンバスと振り返りのプレビューキャンバスの両方がこの定数を共有することで、
 *  「同じ大きさ」を保証する。 */
export const MIN_CANVAS_SIZE = 200;
/** 以前は900だったが、上部のタイトル表示を廃止して画面切り替えを下部の操作パネルに
 *  統合したことで縦方向の余白が増えたため、円をさらに大きく見せられるよう引き上げた。 */
export const MAX_CANVAS_SIZE = 1100;

export interface CanvasGeometry {
  width: number;
  height: number;
  /** px per 正規化単位（円の半径px）。 */
  scale: number;
  centerPx: Point;
}

/**
 * コンテナの利用可能な幅・高さのうち小さい方いっぱいまで正方形として広げた時の
 * 一辺（px）。上下限（MIN/MAX_CANVAS_SIZE）だけ設ける。SMUIの右レンズ
 * プレースホルダー（smuiView.ts）が、実際にCircularCanvasが無い間も同じ大きさの
 * 円に見えるよう、この計算だけを単独で使えるようにexportしている。
 */
export function computeSquareSize(container: HTMLElement): number {
  const rect = container.getBoundingClientRect();
  const available = Math.min(rect.width, rect.height || rect.width);
  return Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, available));
}

/**
 * 太い縁取り（frameStrokeWidthピクセル、外枠パスを中心線としてその半分ずつ
 * 内外にはみ出す形で描く——canvasView.ts render()のstrokeScale参照）を持つ
 * 形状が、キャンバスの箱（一辺size）からはみ出さないぎりぎりの大きさで収まる
 * scale（正規化1単位あたりのpx）を計算する。maxReachはこの形状が原点から
 * 最も遠くまで届く距離（正規化単位、frameShape.ts参照）。
 *
 * 縁取りの外側の端までの距離は maxReach*(scale + frameStrokeWidth/2) +
 * frameStrokeWidth/2（=computeOuterReach参照）で、これがsize/2を超えない
 * ようscaleを逆算する。
 *
 * SMUIのレンズ（canvasView.ts）が、固定のcontentScaleFactorではなく
 * 「今のキャンバスの大きさ・縁取りの太さで安全な範囲でなるべく大きく」を
 * 動的に計算するために使う——固定の割合だと、極端に小さいレンズ（MIN_CANVAS_SIZE
 * 付近）でも縁取りが切れない値に合わせて常に控えめにする必要があり、通常の
 * 大きさのレンズでは余白を必要以上に持て余してしまうため。
 */
export function computeAutoScale(size: number, maxReach: number, frameStrokeWidth: number): number {
  const scale = size / (2 * maxReach) - (frameStrokeWidth * (maxReach + 1)) / (2 * maxReach);
  return Math.max(0, scale);
}

/**
 * scale（正規化1単位あたりのpx）とframeStrokeWidthのもとで、ある方向
 * （reachFactor、frameShape.tsのmaxReach/horizontalReach）における縁取りの
 * 外側の端まで、原点からの距離（px）。SMUIのブリッジ（レンズをつなぐ橋、
 * smuiView.ts）を実際に描かれる縁取りの外端にぴったり合わせるために使う。
 */
export function computeOuterReach(scale: number, reachFactor: number, frameStrokeWidth: number): number {
  const strokeScale = scale + frameStrokeWidth / 2;
  return reachFactor * strokeScale + frameStrokeWidth / 2;
}

/**
 * コンテナの利用可能な幅・高さのうち小さい方いっぱいまで正方形として広げ、
 * 上下限だけ設ける。canvas要素の実サイズ（style幅高さ・描画バッファ）を
 * このタイミングで適用し、以後の座標計算に使う半径・中心を返す。
 * contentScaleFactorは固定の割合（数値）のほか、キャンバスの一辺（px）を
 * 受け取ってその都度の割合を返す関数も渡せる（SMUIレンズの動的マージン計算、
 * computeAutoScale参照）。
 */
export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number,
  contentScaleFactor: number | ((size: number) => number) = 0.43
): CanvasGeometry {
  const size = computeSquareSize(container);
  const factor = typeof contentScaleFactor === "function" ? contentScaleFactor(size) : contentScaleFactor;
  const scale = size * factor;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  return { width: size, height: size, scale, centerPx: { x: size / 2, y: size / 2 } };
}
