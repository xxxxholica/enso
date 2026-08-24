import { formatDurationJa } from "./fade";
import type { MemoStore } from "./memoStore";
import type { Point } from "./types";

/** なぞる/移動している（またはPCでホバーしている）メモの「残り時間・回復できる
 *  時間」を表示する案内ボックス（renderReviveInfoBox参照）の配色。text-editor-
 *  overlay（DOM側のテキスト編集欄）と同じ紙色・線色に揃えている。 */
const INFO_BOX_BG = "oklch(98% 0.005 75 / 0.96)";
const INFO_BOX_BORDER = "oklch(22% 0.012 55 / 0.18)";
/** canvasView.tsのHINT_TEXTと同じ値。このファイルをcanvasView.tsに依存しない
 *  独立した葉のモジュールにするため、importせずそのまま複製している
 *  （memoRenderer.tsと同じ流儀）。 */
const HINT_TEXT = "oklch(22% 0.012 55 / 0.4)";

/** currentReviveInfoTargetの判定に必要な、CircularCanvasのDrawStateの一部だけを
 *  構造的に受け取る（canvasView.tsのDrawStateはexportされていないため、
 *  循環参照を避けてこのファイル独自の最小限の型で受け取る）。 */
export interface ReviveInfoDrawState {
  mode: "idle" | "drawing" | "tracing" | "erasing" | "moving";
  tracingMemoId: string | null;
  movingMemoId: string | null;
  lastPoint: Point | null;
}

/**
 * 「残り時間・回復できる時間」の案内を今どのメモ・どの画面位置に出すべきかを
 * 決め（優先順位：実際になぞっている＞実際に移動している＞PCでのホバー）、
 * 表示条件を満たせば背景つきのボックスに文字だけで描く（ユーザー指示：バーは
 * 無くし、文字だけでよい）。条件を満たさなければ何もしない。
 *
 * memoRenderer.tsのrenderMemoAtと同じ流儀（thisを持たない純粋関数、明示的な
 * 引数のみ）で、canvasView.ts側から状態を渡してもらう。
 */
export function renderReviveInfoBox(
  ctx: CanvasRenderingContext2D,
  store: MemoStore,
  r: number,
  state: ReviveInfoDrawState,
  hoverInfoMemoId: string | null,
  hoverInfoPoint: Point | null
): void {
  const target = currentReviveInfoTarget(state, hoverInfoMemoId, hoverInfoPoint);
  if (!target) return;

  const budget = store.reviveBudgetOf(target.memoId);
  if (!budget) return;
  const p = { x: target.point.x * r, y: target.point.y * r };

  const boxW = 220;
  const padding = 18;
  const lineHeight = 22;
  const boxH = padding * 2 + lineHeight * 2;

  const boxX = p.x - boxW / 2;
  const boxY = p.y + 22;
  const textX = boxX + padding;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 16);
  ctx.fillStyle = INFO_BOX_BG;
  ctx.fill();
  ctx.strokeStyle = INFO_BOX_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  drawReviveInfoLine(ctx, textX, boxY + padding + lineHeight * 0.7, "残り時間", formatDurationJa(budget.remainingMs));
  drawReviveInfoLine(
    ctx,
    textX,
    boxY + padding + lineHeight * 1.7,
    "回復できる時間",
    budget.extendableMs > 0 ? formatDurationJa(budget.extendableMs) : "なし"
  );
  ctx.restore();
}

function currentReviveInfoTarget(
  state: ReviveInfoDrawState,
  hoverInfoMemoId: string | null,
  hoverInfoPoint: Point | null
): { memoId: string; point: Point } | null {
  if (state.mode === "tracing" && state.tracingMemoId && state.lastPoint) {
    return { memoId: state.tracingMemoId, point: state.lastPoint };
  }
  if (state.mode === "moving" && state.movingMemoId && state.lastPoint) {
    return { memoId: state.movingMemoId, point: state.lastPoint };
  }
  if (hoverInfoMemoId && hoverInfoPoint) {
    return { memoId: hoverInfoMemoId, point: hoverInfoPoint };
  }
  return null;
}

/** 見出し（薄い文字）＋具体的な量（濃い文字）を1行に横並びで描く。 */
function drawReviveInfoLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  baselineY: number,
  label: string,
  valueText: string
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "12px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = HINT_TEXT;
  ctx.fillText(label, x, baselineY);
  const labelWidth = ctx.measureText(label).width;

  ctx.font = "600 13px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = "oklch(22% 0.012 55)";
  ctx.fillText(valueText, x + labelWidth + 8, baselineY);
}
