import { clampToCircle, clampToEllipse, clampToRoundedRect } from "./geometry";
import type { Point } from "./types";

export type FrameShapeId = "round" | "oval" | "square";
export const DEFAULT_FRAME_SHAPE_ID: FrameShapeId = "round";

/**
 * SMUIのレンズ枠形状。外枠の描画・クリップだけでなく、実際に描画できる領域
 * （ポインタ・移動道具のクランプ境界）も、選んだ形状の輪郭そのものに一致させる
 * ——以前は「形状は見た目のスキンで、クランプは常に半径1の円のまま」という
 * 設計だったが、Oval/Squareで円の外側（見た目の枠の内側）に書き込めない領域が
 * 生まれてしまう問題があったため、この形式に変更した（ユーザー指示）。
 *
 * この変更は左レンズ（既存メインの個人MemoStoreと共有）にも及ぶため、SMUIで
 * 円の外側までメモを動かした場合、その位置は「キャンバス」タブ（形状選択が無く
 * 常に円）や、SMUIを丸眼鏡に戻した状態では円の外にはみ出して見える
 * ——正規化座標の意味自体は変えず、クランプ境界（＝今どの形状を見ているか）
 * だけが view 側の状態として変わる、という設計（ユーザー確認済みの
 * 許容トレードオフ）。
 */
export interface FrameShape {
  id: FrameShapeId;
  label: string;
  /** 原点にtranslate済みのctxに対し、外枠描画・クリップの両方に使うPath2Dを組み立てる。 */
  buildPath(scale: number): Path2D;
  /** このシェイプの原点からの最大到達距離（scale基準）。キャンバス余白の計算に使う。 */
  maxReach: number;
  /** y=0（水平線上）での原点からの到達距離（scale基準）。SMUIのブリッジ（レンズを
   *  つなぐ橋）の幅を、実際のレンズの縁の位置に正確に合わせるために使う
   *  （smuiView.ts参照）。Round/SquareはmaxReachと異なり1（横方向にはみ出さない）、
   *  Ovalは横長なのでmaxReachと同じOVAL_RX_FACTOR。 */
  horizontalReach: number;
  /** 正規化座標上の点を、この形状の輪郭の内側に丸め込む（ポインタ入力・移動道具の
   *  ドラッグで使う）。buildPathと同じ輪郭に一致させること。 */
  clamp(p: Point): Point;
}

const round: FrameShape = {
  id: "round",
  label: "丸眼鏡",
  buildPath(scale) {
    const path = new Path2D();
    path.arc(0, 0, scale, 0, Math.PI * 2);
    return path;
  },
  maxReach: 1.0,
  horizontalReach: 1.0,
  clamp(p) {
    return clampToCircle(p, 1);
  },
};

const OVAL_RX_FACTOR = 1.12;

const oval: FrameShape = {
  id: "oval",
  label: "楕円",
  buildPath(scale) {
    const path = new Path2D();
    path.ellipse(0, 0, scale * OVAL_RX_FACTOR, scale, 0, 0, Math.PI * 2);
    return path;
  },
  maxReach: OVAL_RX_FACTOR,
  horizontalReach: OVAL_RX_FACTOR,
  clamp(p) {
    return clampToEllipse(p, OVAL_RX_FACTOR, 1);
  },
};

const SQUARE_CORNER_RADIUS_FACTOR = 0.3;

const square: FrameShape = {
  id: "square",
  label: "長方形",
  buildPath(scale) {
    const half = scale;
    const r = scale * SQUARE_CORNER_RADIUS_FACTOR;
    const path = new Path2D();
    path.roundRect(-half, -half, half * 2, half * 2, r);
    return path;
  },
  // 角丸部分（半径r、中心(half-r, half-r)の四分円）上で原点から最も遠い点までの距離:
  // √2 * (half - r) + r。half=scale, r=0.3*scaleとして ≈ 1.29 * scale。
  maxReach: Math.SQRT2 * (1 - SQUARE_CORNER_RADIUS_FACTOR) + SQUARE_CORNER_RADIUS_FACTOR,
  horizontalReach: 1.0,
  clamp(p) {
    return clampToRoundedRect(p, 1, SQUARE_CORNER_RADIUS_FACTOR);
  },
};

const FRAME_SHAPES: Record<FrameShapeId, FrameShape> = { round, oval, square };

export const FRAME_SHAPE_ORDER: FrameShapeId[] = ["round", "oval", "square"];

export function getFrameShape(id: FrameShapeId): FrameShape {
  return FRAME_SHAPES[id];
}

/**
 * 3形状のうちもっとも大きいmaxReach（＝長方形の角）。SMUIのレンズは、今選んで
 * いる形状に関わらず常にこの値を基準にキャンバスの余白を計算する
 * ——形状ごとに余白を最小化すると、丸眼鏡・楕円は大きく、長方形だけ角のぶん
 * 余白が要ってあまり大きくならず、形状を切り替えるたびに大きさが変わって
 * しまう（ブリッジの長さも形状によって変わって見えてしまう）。3形状とも
 * 同じ余白基準に揃えることで、切り替えても大きさ・接合部の長さが変わらない
 * （ユーザー指摘：長方形の接合部だけ短くなっていないように見える、への対応）。
 */
export const MAX_SHAPE_REACH = Math.max(...FRAME_SHAPE_ORDER.map((id) => FRAME_SHAPES[id].maxReach));
