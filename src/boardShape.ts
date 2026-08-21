import { clampToCircle, distance, isInsideCircle } from "./geometry";
import type { Point } from "./types";

export type BoardShapeId = "circle" | "glasses";

export const DEFAULT_BOARD_SHAPE_ID: BoardShapeId = "circle";

/**
 * 盤面の形。正規化座標系（原点=盤面の中心、既存の「円の半径を1とする」座標系を
 * 引き続き使う）での内外判定・クランプと、px単位で外枠/クリップに使うPath2Dを提供する。
 */
export interface BoardShape {
  id: BoardShapeId;
  label: string;
  /** バウンディングボックスの半幅・半高（正規化単位）。canvasSizingが利用可能な
   *  領域に収める際の縦横比・余白の基準に使う。円は1:1。 */
  halfWidth: number;
  halfHeight: number;
  isInside(p: Point): boolean;
  /** pを盤面の内側に丸め込む（外にあれば境界上の最も近い点へ）。 */
  clamp(p: Point): Point;
  /** 原点にtranslate済みのctxに対して、外枠の描画とクリップの両方に使えるPath2Dを組み立てる。 */
  buildPath(scale: number): Path2D;
}

const CIRCLE: BoardShape = {
  id: "circle",
  label: "円",
  halfWidth: 1,
  halfHeight: 1,
  isInside(p) {
    return isInsideCircle(p, 1);
  },
  clamp(p) {
    return clampToCircle(p, 1);
  },
  buildPath(scale) {
    const path = new Path2D();
    path.arc(0, 0, scale, 0, Math.PI * 2);
    return path;
  },
};

/** 眼鏡型: 左右2つのレンズ円と、間を繋ぐブリッジ（横長の矩形）の合わせ技。 */
const LENS_RADIUS = 0.56;
const LENS_CENTER_X = 0.6;
const BRIDGE_HALF_W = LENS_CENTER_X;
const BRIDGE_HALF_H = 0.12;

function clampToLens(p: Point, lensCenterX: number): Point {
  const dx = p.x - lensCenterX;
  const dy = p.y;
  const d = Math.hypot(dx, dy);
  if (d <= LENS_RADIUS) return p;
  const scale = LENS_RADIUS / d;
  return { x: lensCenterX + dx * scale, y: dy * scale };
}

function clampToBridge(p: Point): Point {
  return {
    x: Math.max(-BRIDGE_HALF_W, Math.min(BRIDGE_HALF_W, p.x)),
    y: Math.max(-BRIDGE_HALF_H, Math.min(BRIDGE_HALF_H, p.y)),
  };
}

function isInsideLens(p: Point, lensCenterX: number): boolean {
  const dx = p.x - lensCenterX;
  return dx * dx + p.y * p.y <= LENS_RADIUS * LENS_RADIUS;
}

function isInsideBridge(p: Point): boolean {
  return Math.abs(p.x) <= BRIDGE_HALF_W && Math.abs(p.y) <= BRIDGE_HALF_H;
}

const GLASSES: BoardShape = {
  id: "glasses",
  label: "眼鏡",
  halfWidth: LENS_CENTER_X + LENS_RADIUS,
  halfHeight: LENS_RADIUS,
  isInside(p) {
    return isInsideLens(p, -LENS_CENTER_X) || isInsideLens(p, LENS_CENTER_X) || isInsideBridge(p);
  },
  clamp(p) {
    if (GLASSES.isInside(p)) return p;
    const candidates = [clampToLens(p, -LENS_CENTER_X), clampToLens(p, LENS_CENTER_X), clampToBridge(p)];
    let best = candidates[0];
    let bestDist = distance(p, best);
    for (const c of candidates.slice(1)) {
      const d = distance(p, c);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  },
  buildPath(scale) {
    const path = new Path2D();
    path.arc(-LENS_CENTER_X * scale, 0, LENS_RADIUS * scale, 0, Math.PI * 2);
    path.arc(LENS_CENTER_X * scale, 0, LENS_RADIUS * scale, 0, Math.PI * 2);
    path.rect(-BRIDGE_HALF_W * scale, -BRIDGE_HALF_H * scale, BRIDGE_HALF_W * 2 * scale, BRIDGE_HALF_H * 2 * scale);
    return path;
  },
};

export const BOARD_SHAPES: Record<BoardShapeId, BoardShape> = {
  circle: CIRCLE,
  glasses: GLASSES,
};

export function getBoardShape(id: BoardShapeId): BoardShape {
  return BOARD_SHAPES[id] ?? BOARD_SHAPES[DEFAULT_BOARD_SHAPE_ID];
}
