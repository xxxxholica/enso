// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameGeometry } from "../src/frameGeometry";

function makeFakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    fillRect: () => {},
    beginPath: () => {},
    ellipse: () => {},
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    clip: () => {},
  } as unknown as CanvasRenderingContext2D;
}

class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  ellipse(): void {}
  closePath(): void {}
  rect(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  addPath(): void {}
}

function makeContainer(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  return el;
}

beforeEach(() => {
  // フレーム柄(framePattern.ts)がべっ甲/木目の柄を組み立てる際に内部で
  // オフスクリーンcanvasを作りgetContext("2d")するため、jsdomにcanvas 2D
  // contextの実装が無い分をここでまとめて差し替える。
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => makeFakeCtx() as unknown as RenderingContext
  );
  // jsdomにはPath2Dの実装が無いため、frameShape.tsのbuildPath()が動くよう
  // 最小限のスタブを補う（このテストではパスの形そのものは検証しない）。
  (globalThis as unknown as { Path2D: unknown }).Path2D = FakePath2D;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FrameGeometry: 共同アイデア出しの参加人数(レンズ分割の組数)と縁取りの太さ (issue #113②)", () => {
  it("組数(pairCount)が増えても、個々のフレームの縁取りの太さ・スケールは初期状態から変わらない", () => {
    const canvas = document.createElement("canvas");
    const ctx = makeFakeCtx();
    const container = makeContainer(400, 2000);

    const geometry = new FrameGeometry(canvas, ctx, container, 1, {
      frameShapeId: "round",
      frameStrokeColor: "#000",
      frameStrokeWidth: (canvasSizePx) => canvasSizePx * 0.04,
      frameKind: "glasses",
      framePatternId: "matte",
    });

    const baselineStrokeWidth = geometry.frameStrokeWidthPx;

    // 3人以上の参加(maxParticipants>=3)でcomputeLensSplitPairCountが1→2になる状況を再現する。
    geometry.setLensSplitPairCount(2);
    expect(geometry.frameStrokeWidthPx).toBeCloseTo(baselineStrokeWidth, 5);
  });
});
