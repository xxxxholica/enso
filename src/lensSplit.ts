import { clampToOffsetLens } from "./geometry";
import { GLASSES_CENTER_OFFSET, GLASSES_HORIZONTAL_REACH_WITH_HINGE, GLASSES_VERTICAL_REACH, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import type { Point } from "./types";

/**
 * フェーズ①(ideation)の共有キャンバスを、メガネ3組(6レンズ)に見た目上分割する
 * レイアウト計算。データモデル(Memo/MemoStore)は一切変更せず、既存の単一の
 * 共有キャンバス・座標系の上に3組ぶんのレンズ形状を平行移動して描くだけ
 * ——詳細はissue #79参照。
 */
export const LENS_COUNT = 6;

/** 隣り合う組の間の見た目上の隙間（正規化単位、GLASSES_CENTER_OFFSET等と同じ基準）。
 *  以前は0.3(組の横幅の1割未満)で、組同士がほぼ隙間なくくっついて見えていた
 *  （issue #79、ユーザー指摘）ため、はっきり離れて見える大きさまで広げた。 */
const LENS_PAIR_GAP = 1.2;

/** セッションの参加人数上限から、実際に描画すべき組の数を決める。参加人数分
 *  だけ用意すればよいため、常に3組(6レンズ)を描いていた以前の固定値をやめ、
 *  2人につき1組を目安に切り上げる(1人でも1組は要る)。LENS_COUNTを超える
 *  参加者は既存仕様通りレンズ分割の対象外(閲覧専用)のため、組数の計算にも
 *  数えない（issue #79、ユーザー指摘: 参加人数以上の眼鏡が用意される問題）。 */
export function computeLensSplitPairCount(maxParticipants: number): number {
  return Math.max(1, Math.ceil(Math.min(maxParticipants, LENS_COUNT) / 2));
}

export type LensSplitDirection = "row" | "column";

/** 画面(コンテナ)の縦横比から配置方向を決める。眼鏡1組は横長(≈2.5:1)のため、
 *  横長画面(PC)ではrow(横並び)、縦長画面(スマホ)ではcolumn(縦積み)にする。 */
export function chooseLensSplitDirection(width: number, height: number): LensSplitDirection {
  return width >= height ? "row" : "column";
}

/** pairCount組ぶんの中心座標（正規化単位）。中央(または中央寄り)が原点付近、
 *  残りが対称に配置される。row=x方向、column=y方向にオフセットする。 */
export function computeLensPairCenters(direction: LensSplitDirection, pairCount: number): Point[] {
  const step =
    direction === "row"
      ? 2 * GLASSES_HORIZONTAL_REACH_WITH_HINGE + LENS_PAIR_GAP
      : 2 * GLASSES_VERTICAL_REACH + LENS_PAIR_GAP;
  const mid = (pairCount - 1) / 2;
  return Array.from({ length: pairCount }, (_, i) => {
    const offset = (i - mid) * step;
    return direction === "row" ? { x: offset, y: 0 } : { x: 0, y: offset };
  });
}

/** レンズ番号(0-5、session.myColorIndexをそのまま流用)から、どの組の
 *  どちら側(右/左)かを求める。0,1→組0、2,3→組1、4,5→組2、各組の偶数側がright。 */
export function lensIndexToPairSlot(lensIndex: number): { pairIndex: number; side: "right" | "left" } {
  return { pairIndex: Math.floor(lensIndex / 2), side: lensIndex % 2 === 0 ? "right" : "left" };
}

/** 指定レンズ番号の絶対中心座標（正規化単位、まだscale/pxを掛けていない）。 */
export function lensAbsoluteCenter(pairCenters: Point[], lensIndex: number): Point {
  const { pairIndex, side } = lensIndexToPairSlot(lensIndex);
  const pairCenter = pairCenters[pairIndex] ?? pairCenters[pairCenters.length - 1];
  const dx = side === "right" ? GLASSES_CENTER_OFFSET : -GLASSES_CENTER_OFFSET;
  return { x: pairCenter.x + dx, y: pairCenter.y };
}

/** 自分の担当レンズだけに書き込みを制限するクランプ。担当レンズは
 *  session.myColorIndexから一意に決まっているため、clampToGlassesのような
 *  「近い方を選ぶ」探索は不要——lensAbsoluteCenterへ平行移動した単一レンズの
 *  clampをそのまま使うだけ。 */
export function buildOwnLensClamp(
  frameShapeId: FrameShapeId,
  pairCenters: Point[],
  lensIndex: number
): (p: Point) => Point {
  const center = lensAbsoluteCenter(pairCenters, lensIndex);
  const lensClamp = getFrameShape(frameShapeId).clamp;
  return (p) => clampToOffsetLens(p, lensClamp, center);
}
