import type { Point, Stroke } from "./types";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点 p から線分 ab までの最短距離。 */
export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const proj: Point = { x: a.x + t * abx, y: a.y + t * aby };
  return distance(p, proj);
}

/** 点 p がストローク（折れ線）から threshold 以内にあるか。 */
export function pointNearStroke(p: Point, stroke: Stroke, threshold: number): boolean {
  if (stroke.length === 0) return false;
  if (stroke.length === 1) return distance(p, stroke[0]) <= threshold;
  for (let i = 0; i < stroke.length - 1; i++) {
    if (pointToSegmentDistance(p, stroke[i], stroke[i + 1]) <= threshold) {
      return true;
    }
  }
  return false;
}

/** 点 p がメモを構成するいずれかのストロークから threshold 以内にあるか。 */
export function pointNearStrokes(p: Point, strokes: Stroke[], threshold: number): boolean {
  return strokes.some((s) => pointNearStroke(p, s, threshold));
}

/**
 * 円（center中心・半径radius）が、中心(box.x, box.y)を持つ矩形(box.width x box.height)と
 * 重なっているか。テキストメモの当たり判定（なぞって復活・消しゴム）に使う
 * ——矩形に最も近い円周上の点との距離で判定する標準的な円と矩形の衝突判定。
 */
export function circleIntersectsBox(
  center: Point,
  radius: number,
  box: { x: number; y: number; width: number; height: number }
): boolean {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const closestX = Math.max(box.x - halfW, Math.min(center.x, box.x + halfW));
  const closestY = Math.max(box.y - halfH, Math.min(center.y, box.y + halfH));
  return distance(center, { x: closestX, y: closestY }) <= radius;
}

/** 円（原点中心・半径 radius）の内側に点を丸め込む。 */
export function clampToCircle(p: Point, radius: number): Point {
  const d = Math.hypot(p.x, p.y);
  if (d <= radius) return p;
  const scale = radius / d;
  return { x: p.x * scale, y: p.y * scale };
}

export function isInsideCircle(p: Point, radius: number): boolean {
  return p.x * p.x + p.y * p.y <= radius * radius;
}

/**
 * 消しゴム: center から radius 以内にある点をストロークから取り除く。
 * 取り除いた場所でストロークが分断される場合は、複数の断片に分けて返す
 * （2点未満になった断片は消える）。全く消えなければ元と同じ内容の1本を返す。
 */
export function eraseFromStroke(stroke: Stroke, center: Point, radius: number): Stroke[] {
  const touched = stroke.some((p) => distance(p, center) <= radius);
  if (!touched) return [stroke];

  const segments: Stroke[] = [];
  let current: Stroke = [];
  for (const p of stroke) {
    if (distance(p, center) <= radius) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}
