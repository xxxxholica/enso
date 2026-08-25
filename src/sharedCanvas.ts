import { authFetch } from "./apiClient";
import type { Memo } from "./types";

/**
 * 共有キャンバス（コラボ機能）のAPI呼び出し。api.onunu.me の /shared-canvases 系。
 * すべてのエンドポイントで Authorization ヘッダーが必須のため、未ログイン時は
 * 呼び出し元（smuiView.ts）でガードすること。
 *
 * 作成・参加・一覧・閲覧・退出・名前変更に加え、PUTによる保存も行う（SMUIの
 * 右レンズで実際に書き込めるようにするため）。同時編集の競合解決（楽観ロック等）
 * は行わず、最後に保存した内容が勝つ単純な方式（sharedCanvasSync.ts側でポーリングする）。
 */

export interface SharedCanvasSummary {
  id: string;
  /** ルームの名前。未設定はnull（バックエンド仕様、2026-08-24からPATCHで保存可能に）。 */
  name: string | null;
}

/** 進行中の「共同アイデア出し」セッションの状態（未開始の間はnull）。 */
export interface SessionState {
  phase: "ideation" | "discussion" | "voting";
  /** このフェーズが自動的に次へ進む予定時刻(ms epoch)。ルームマスターの延長操作で伸びる。 */
  phaseEndsAt: number;
  phase1Ms: number;
  phase2Ms: number;
  phase3Ms: number;
  maxParticipants: number;
  /** フェーズ①用に自分に払い出された色インデックス。未割当(色プール枯渇時)はnull。 */
  myColorIndex: number | null;
}

export interface SharedCanvasDetail {
  id: string;
  /** ルームの作成者=ルームマスター。セッションの開始・進行操作が行えるかの判定に使う。 */
  ownerId: string;
  memos: Memo[];
  session: SessionState | null;
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
  return raw
    .filter(
      (item): item is { id: string; name?: unknown } =>
        typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
    )
    .map((item) => ({ id: item.id, name: typeof item.name === "string" ? item.name : null }));
}

/** 招待リンク経由で共有キャンバスのメンバーに加わる。 */
export async function joinSharedCanvas(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/join`, { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスへの参加に失敗しました (status: ${res.status})`);
}

/** 自分をメンバーから外す（退出）。残りメンバーが0人になった場合は、その場で
 *  ルーム自体もサーバー側で削除される（バックエンド仕様、2026-08-24）。 */
export async function leaveSharedCanvas(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/leave`, { method: "POST" });
  if (!res.ok) throw new Error(`共有キャンバスからの退出に失敗しました (status: ${res.status})`);
}

/** ルームの名前を保存する（メンバー外は403、1〜100文字以外は400で失敗する）。
 *  保存後は既存のWebSocket通知（{type:"changed"}）経由で他のメンバーにも
 *  反映される（バックエンド仕様）。 */
export async function renameSharedCanvas(id: string, name: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`ルーム名の保存に失敗しました (status: ${res.status})`);
}

function parseSession(data: unknown): SessionState | null {
  const session = (data as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  return session as SessionState;
}

/** 指定した共有キャンバスの中身を取得する（メンバー外は403で失敗する）。 */
export async function getSharedCanvas(id: string): Promise<SharedCanvasDetail> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`共有キャンバスの取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const memos = (data as { memos?: unknown }).memos;
  const ownerId = (data as { ownerId?: unknown }).ownerId;
  return {
    id,
    ownerId: typeof ownerId === "string" ? ownerId : "",
    memos: Array.isArray(memos) ? (memos as Memo[]) : [],
    session: parseSession(data),
  };
}

/** 指定した共有キャンバスの中身を保存する（メンバー外は403で失敗する）。 */
export async function saveSharedCanvas(id: string, memos: readonly Memo[]): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memos }),
  });
  if (!res.ok) throw new Error(`共有キャンバスの保存に失敗しました (status: ${res.status})`);
}

// --- 共同アイデア出しセッション（ルームマスターのみ開始・進行・延長・終了できる） ---

export interface StartSessionOptions {
  phase1Ms: number;
  phase2Ms: number;
  phase3Ms: number;
  maxParticipants: number;
}

/** セッションを開始する（ルームマスター以外は403、既にセッション中なら409で失敗する）。 */
export async function startSession(id: string, options: StartSessionOptions): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(`セッションの開始に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** 次のフェーズへ進める。voting中に呼ぶと、確定処理をしてセッションを終了する。 */
export async function advanceSession(id: string): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/advance`, { method: "POST" });
  if (!res.ok) throw new Error(`フェーズの進行に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** 現在のフェーズの残り時間をaddMsぶん延長する。 */
export async function extendSession(id: string, addMs: number): Promise<SessionState | null> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addMs }),
  });
  if (!res.ok) throw new Error(`延長に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  return parseSession(data);
}

/** セッションを終了する。votingフェーズ中ならメモの濃さを確定させ、それ以外は
 *  何も確定させずに中断する。 */
export async function endSession(id: string): Promise<void> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/session/end`, { method: "POST" });
  if (!res.ok) throw new Error(`セッションの終了に失敗しました (status: ${res.status})`);
}

/** 投票フェーズ専用: メモを1回転させた時に呼ぶ。熱量+1後の値をサーバーから受け取る
 *  （楽観的にローカルへ反映済みの値をここで確定値に合わせ直す想定）。相対密度の
 *  計算は毎フレーム全メモから計算し直す(canvasView.ts)ため、サーバーが返す
 *  maxHeatは使わない——レスポンスにはheatだけを残す。 */
export async function addMemoHeat(id: string, memoId: string): Promise<{ heat: number }> {
  const res = await authFetch(`/shared-canvases/${encodeURIComponent(id)}/memos/${encodeURIComponent(memoId)}/heat`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`熱量の加算に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const heat = (data as { heat?: unknown }).heat;
  return { heat: typeof heat === "number" ? heat : 0 };
}
