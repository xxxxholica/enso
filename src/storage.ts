import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, normalizedBoxSize } from "./textLayout";
import type { DrawTool, Memo, StrokeMemo, TextMemo } from "./types";

const STORAGE_KEY = "memos";
const DEFAULT_TOOL: DrawTool = "pen";
const DEFAULT_COLOR = "oklch(22% 0.012 55)";

function isMemoShaped(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const baseOk =
    typeof m.id === "string" &&
    typeof m.x === "number" &&
    typeof m.y === "number" &&
    typeof m.createdAt === "number" &&
    typeof m.lastTracedAt === "number" &&
    (m.lifespanDays === null || typeof m.lifespanDays === "number") &&
    (m.status === "active" || m.status === "faded");
  if (!baseOk) return false;

  if (m.kind === "text") return typeof m.text === "string";
  // kindが無い場合（テキスト機能追加前の古いデータ）も含め、手描きメモとして扱う
  return Array.isArray(m.strokes);
}

/**
 * 古い形式のデータ（道具・色・なぞり履歴・kindを持たない）を補い、現在の形式に揃える。
 * traceHistoryが無い場合はcreatedAt/lastTracedAtから最善の推測で組み立てる
 * （複数回なぞり直した履歴までは復元できないが、破綻はしない）。
 */
function migrate(raw: Record<string, unknown>): Memo {
  const createdAt = raw.createdAt as number;
  const lastTracedAt = raw.lastTracedAt as number;
  const hasValidTraceHistory =
    Array.isArray(raw.traceHistory) && raw.traceHistory.every((n) => typeof n === "number");
  const traceHistory = hasValidTraceHistory
    ? (raw.traceHistory as number[])
    : lastTracedAt !== createdAt
      ? [createdAt, lastTracedAt]
      : [createdAt];

  const base = {
    id: raw.id as string,
    x: raw.x as number,
    y: raw.y as number,
    createdAt,
    lastTracedAt,
    traceHistory,
    lifespanDays: raw.lifespanDays as Memo["lifespanDays"],
    status: raw.status as Memo["status"],
    color: typeof raw.color === "string" ? raw.color : DEFAULT_COLOR,
  };

  if (raw.kind === "text") {
    const text = typeof raw.text === "string" ? raw.text : "";
    const fontSize =
      typeof raw.fontSize === "number" ? raw.fontSize : FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
    const hasValidLines =
      Array.isArray(raw.textLines) && raw.textLines.every((l) => typeof l === "string");
    const textLines = hasValidLines ? (raw.textLines as string[]) : [text];
    const fallbackBox = normalizedBoxSize(fontSize, textLines.length);
    const textMemo: TextMemo = {
      ...base,
      kind: "text",
      text,
      textLines,
      fontSize,
      boxWidth: typeof raw.boxWidth === "number" ? raw.boxWidth : fallbackBox.width,
      boxHeight: typeof raw.boxHeight === "number" ? raw.boxHeight : fallbackBox.height,
    };
    return textMemo;
  }

  const strokeMemo: StrokeMemo = {
    ...base,
    kind: "stroke",
    strokes: raw.strokes as StrokeMemo["strokes"],
    tool: typeof raw.tool === "string" ? (raw.tool as DrawTool) : DEFAULT_TOOL,
  };
  return strokeMemo;
}

export function loadMemos(): Memo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoShaped).map(migrate);
  } catch {
    // 壊れたデータは復元不能として扱い、空から始める（例外は投げない）
    return [];
  }
}

export function saveMemos(memos: Memo[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
}
