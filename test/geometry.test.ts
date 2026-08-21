import { describe, expect, it } from "vitest";
import {
  circleIntersectsBox,
  clampToCircle,
  eraseFromStroke,
  isInsideCircle,
  pointNearStroke,
  pointNearStrokes,
  pointToSegmentDistance,
} from "../src/geometry";

describe("clampToCircle", () => {
  it("円内の点はそのまま", () => {
    expect(clampToCircle({ x: 10, y: 10 }, 100)).toEqual({ x: 10, y: 10 });
  });

  it("円外の点は境界上に丸め込まれる", () => {
    const p = clampToCircle({ x: 200, y: 0 }, 100);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
    expect(isInsideCircle(p, 100)).toBe(true);
  });

  it("斜め方向でも半径ちょうどに収まる", () => {
    const p = clampToCircle({ x: 300, y: 400 }, 100);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100);
  });
});

describe("pointToSegmentDistance", () => {
  it("線分の真上なら距離0", () => {
    expect(pointToSegmentDistance({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });

  it("端点より外側は端点までの距離になる", () => {
    const d = pointToSegmentDistance({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(5);
  });
});

describe("pointNearStroke / pointNearStrokes（なぞって復活のヒット判定）", () => {
  const stroke = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("しきい値内ならヒットする", () => {
    expect(pointNearStroke({ x: 5, y: 2 }, stroke, 5)).toBe(true);
  });

  it("しきい値より遠ければヒットしない", () => {
    expect(pointNearStroke({ x: 5, y: 50 }, stroke, 5)).toBe(false);
  });

  it("複数ストローク中のどれか一つに当たればヒット", () => {
    const other = [{ x: 100, y: 100 }, { x: 110, y: 100 }];
    expect(pointNearStrokes({ x: 5, y: 2 }, [other, stroke], 5)).toBe(true);
  });

  it("空のストロークにはヒットしない", () => {
    expect(pointNearStroke({ x: 0, y: 0 }, [], 100)).toBe(false);
  });
});

describe("eraseFromStroke（消しゴム）", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 15, y: 0 },
    { x: 20, y: 0 },
  ];

  it("中央を消すと左右2本に分断される", () => {
    const result = eraseFromStroke(line, { x: 10, y: 0 }, 3);
    expect(result).toHaveLength(2);
    expect(result[0].every((p) => p.x <= 5)).toBe(true);
    expect(result[1].every((p) => p.x >= 15)).toBe(true);
  });

  it("何も触れなければ1本のまま", () => {
    const result = eraseFromStroke(line, { x: 100, y: 100 }, 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(line);
  });

  it("全体を覆う半径で消すと何も残らない", () => {
    const result = eraseFromStroke(line, { x: 10, y: 0 }, 100);
    expect(result).toHaveLength(0);
  });

  it("1点だけ残る断片は捨てられる（線として成立しないため）", () => {
    const twoPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = eraseFromStroke(twoPoints, { x: 100, y: 0 }, 3);
    expect(result).toHaveLength(0);
  });
});

describe("circleIntersectsBox（テキストメモの当たり判定: なぞって復活・消しゴム）", () => {
  const box = { x: 0, y: 0, width: 10, height: 4 };

  it("矩形の内側なら重なっている", () => {
    expect(circleIntersectsBox({ x: 0, y: 0 }, 0.5, box)).toBe(true);
  });

  it("矩形からしきい値以内なら重なっている（辺の外側）", () => {
    expect(circleIntersectsBox({ x: 0, y: 3 }, 1.5, box)).toBe(true);
  });

  it("矩形から十分離れていれば重ならない", () => {
    expect(circleIntersectsBox({ x: 0, y: 100 }, 1, box)).toBe(false);
  });

  it("角に近い場合も正しく判定する", () => {
    // 矩形は x:[-5,5] y:[-2,2]。角(5,2)から少し外側の点。
    expect(circleIntersectsBox({ x: 6, y: 3 }, 1.5, box)).toBe(true);
    expect(circleIntersectsBox({ x: 6, y: 3 }, 1.3, box)).toBe(false);
  });
});
