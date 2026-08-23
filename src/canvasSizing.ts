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
 * frameStrokeWidth/2で、これがsize/2を超えないようscaleを逆算する
 * （実際の縁取り描画がfillベースになった今の方式が必要とする余白
 * maxReach*scale + frameStrokeWidthより常に大きい、安全側の見積もり）。
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
 * コンテナの利用可能な幅・高さに収まる、指定アスペクト比（幅/高さ）の最大の
 * 矩形サイズを返す。高さ（aspectRatio>=1を前提に短辺側になる）にだけ
 * MIN/MAX_CANVAS_SIZEを適用する。共有キャンバス（眼鏡形状、横長）が
 * computeSquareSize/fitCanvasToContainerの「常に正方形」という前提に
 * 合わないため、横長コンテナ向けに新設した。
 */
export function computeRectSize(container: HTMLElement, aspectRatio: number): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const availW = rect.width;
  const availH = rect.height || rect.width / aspectRatio;

  let width = availW;
  let height = width / aspectRatio;
  if (height > availH) {
    height = availH;
    width = height * aspectRatio;
  }

  height = Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, height));
  width = height * aspectRatio;

  // MIN_CANVAS_SIZEへの引き上げは、狭い画面×横長のaspectRatio（眼鏡形状など）
  // では幅がavailWを超えてしまうことがある——コンテナの外にはみ出す（ヒンジ等の
  // 装飾が画面端で切れる）よりは、下限を割ってでも幅内に収める方を優先する。
  if (width > availW) {
    width = availW;
    height = width / aspectRatio;
  }
  return { width, height };
}

/**
 * コンテナの利用可能な幅・高さのうち小さい方いっぱいまで正方形として広げ、
 * 上下限だけ設ける。canvas要素の実サイズ（style幅高さ・描画バッファ）を
 * このタイミングで適用し、以後の座標計算に使う半径・中心を返す。
 * contentScaleFactorは固定の割合（数値）のほか、キャンバスの一辺（px）を
 * 受け取ってその都度の割合を返す関数も渡せる（SMUIレンズの動的マージン計算、
 * computeAutoScale参照）。呼び出し元がすでにcomputeSquareSize(container)を
 * 計算済みなら、getBoundingClientRect()の二重呼び出しを避けるためsizeで渡せる。
 */
export function fitCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  dpr: number,
  contentScaleFactor: number | ((size: number) => number) = 0.43,
  size: number = computeSquareSize(container)
): CanvasGeometry {
  const factor = typeof contentScaleFactor === "function" ? contentScaleFactor(size) : contentScaleFactor;
  const scale = size * factor;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  return { width: size, height: size, scale, centerPx: { x: size / 2, y: size / 2 } };
}
