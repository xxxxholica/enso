import { authFetch } from "./apiClient";
import type { Memo } from "./types";

/**
 * 共有キャンバス（コラボ機能）のAPI呼び出し。api.onunu.me の /shared-canvases 系。
 * すべてのエンドポイントで Authorization ヘッダーが必須のため、未ログイン時は
 * 呼び出し元（sharedCanvasView.ts）でガードすること。
 *
 * スコープ（今回=Lv1でやること）: 作成・参加・一覧・閲覧のみ。
 * 書き込みの保存（PUT）・楽観ロック(409)の扱いはコラボ機能Lv2側の課題であり、ここでは実装しない。
 */

export interface SharedCanvasSummary {
  id: string;
}

export interface SharedCanvasDetail {
  id: string;
  memos: Memo[];
}

/** 新しい共有キャンバスを作る。作った本人がownerメンバーになる。ルームIDを返す。 */
export async function createSharedCanvas(): Promise<string> {
  const res = await authFetch("/shared-canvases", { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスの作成に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const id = (data as { id?: unknown }).id;
  if (typeof id !== "string") throw new Error("サーバーの応答にidが含まれていません");
  return id;
}

/** 自分が参加中の共有キャンバス一覧。 */
export async function listSharedCanvases(): Promise<SharedCanvasSummary[]> {
  const res = await authFetch("/shared-canvases");
  if (!res.ok) throw new Error(`共有キャンバス一覧の取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const raw = Array.isArray(data) ? data : (data as { canvases?: unknown }).canvases;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is SharedCanvasSummary =>
      typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
  );
}

/** 招待リンク経由で共有キャンバスのメンバーに加わる。 */
export async function joinSharedCanvas(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/join`, { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスへの参加に失敗しました (status: ${res.status})`);
}

/** 指定した共有キャンバスの中身を取得する（メンバー外は403で失敗する）。 */
export async function getSharedCanvas(id: string): Promise<SharedCanvasDetail> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`共有キャンバスの取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const memos = (data as { memos?: unknown }).memos;
  return { id, memos: Array.isArray(memos) ? (memos as Memo[]) : [] };
}
