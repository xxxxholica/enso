import { describe, expect, it } from "vitest";
import { computeLensPairCenters, computeLensSplitPairCount, lensIndexToPairSlot, LENS_COUNT } from "../src/lensSplit";

describe("computeLensSplitPairCount（issue #79: 参加人数以上の眼鏡が用意される問題）", () => {
  it("2人につき1組を目安に切り上げる", () => {
    expect(computeLensSplitPairCount(2)).toBe(1);
    expect(computeLensSplitPairCount(3)).toBe(2);
    expect(computeLensSplitPairCount(4)).toBe(2);
  });

  it("1人でも最低1組は用意する", () => {
    expect(computeLensSplitPairCount(1)).toBe(1);
  });

  it("LENS_COUNT(4)を超える参加人数は、レンズ分割の対象外の人数を組数に数えない(3組は表示が不安定なため上限2組)", () => {
    expect(computeLensSplitPairCount(5)).toBe(2);
    expect(computeLensSplitPairCount(8)).toBe(2);
    expect(LENS_COUNT).toBe(4);
  });
});

describe("computeLensPairCenters", () => {
  it("1組の時は原点1点だけ(レンズ分割無効時と同じ結果になり回帰しない)", () => {
    expect(computeLensPairCenters("row", 1)).toEqual([{ x: 0, y: 0 }]);
    expect(computeLensPairCenters("column", 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it("row方向はx軸上に、中央が原点になるよう対称に並ぶ", () => {
    const centers = computeLensPairCenters("row", 3);
    expect(centers).toHaveLength(3);
    expect(centers[1]).toEqual({ x: 0, y: 0 });
    expect(centers[0].y).toBe(0);
    expect(centers[2].y).toBe(0);
    expect(centers[0].x).toBeCloseTo(-centers[2].x);
    expect(centers[0].x).toBeLessThan(centers[1].x);
    expect(centers[1].x).toBeLessThan(centers[2].x);
  });

  it("column方向はy軸上に、隣接する組同士が均等な間隔で並ぶ", () => {
    const centers = computeLensPairCenters("column", 2);
    expect(centers).toHaveLength(2);
    expect(centers[0].x).toBe(0);
    expect(centers[1].x).toBe(0);
    expect(centers[0].y).toBeCloseTo(-centers[1].y);
  });
});

describe("lensIndexToPairSlot", () => {
  it("レンズ番号を組番号・左右に変換する(偶数=right, 奇数=left)", () => {
    expect(lensIndexToPairSlot(0)).toEqual({ pairIndex: 0, side: "right" });
    expect(lensIndexToPairSlot(1)).toEqual({ pairIndex: 0, side: "left" });
    expect(lensIndexToPairSlot(2)).toEqual({ pairIndex: 1, side: "right" });
    expect(lensIndexToPairSlot(5)).toEqual({ pairIndex: 2, side: "left" });
  });
});
