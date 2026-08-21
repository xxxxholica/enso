import { _setApiTokenGetter, authFetch, isSignedIn } from "./apiClient";
import type { TokenGetter } from "./apiClient";
import type { Memo } from "./types";

/**
 * ログイン中のアカウントにキャンバスの状態を紐づけるための、サーバー(api.onunu.me)との同期。
 *
 * スコープ（今回やること）:
 * - ログインしたら、そのアカウントに保存済みのキャンバスがあれば取得してローカルを上書きする。
 * - 保存済みがまだ無ければ、今のローカルの内容をそのままアップロードして初期バックアップにする。
 * - ログイン中の変更は、少し待って（連続する描画をまとめて）1回だけサーバーに送る。
 *
 * スコープ外（今回はやらないこと。コラボ機能側の課題）:
 * - 複数端末・複数人での同時編集や競合解決。ここでは「最後に同期した内容で丸ごと上書き」という
 *   単純な方式のみ。同時に複数端末から使うと、後から同期した方が勝つ。
 */

const PUSH_DEBOUNCE_MS = 2000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;

/** ログイン状態が変わるたびに、Clerkのセッションからトークンを取れる関数を差し替える。未ログインならnullを渡す。 */
export function setTokenGetter(getter: TokenGetter | null): void {
  _setApiTokenGetter(getter);
  if (!getter && pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
}

/** サーバー側に保存済みのメモ一覧を取得する。まだ何も保存していない場合はnullを返す。 */
async function pullCanvas(): Promise<Memo[] | null> {
  const res = await authFetch("/canvas");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`クラウドからの取得に失敗しました (status: ${res.status})`);
  const data: unknown = await res.json();
  const memos = (data as { memos?: unknown }).memos;
  return Array.isArray(memos) ? (memos as Memo[]) : null;
}

async function pushCanvasNow(memos: readonly Memo[]): Promise<void> {
  const res = await authFetch("/canvas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memos }),
  });
  if (!res.ok) throw new Error(`クラウドへの保存に失敗しました (status: ${res.status})`);
}

/** ローカルの変更をデバウンスしてサーバーに反映する。描画中の連続した点の追加のたびには送らない。 */
export function schedulePush(memos: readonly Memo[]): void {
  if (!isSignedIn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushCanvasNow(memos).catch((e) => {
      console.error("[cloudSync] push failed", e);
    });
  }, PUSH_DEBOUNCE_MS);
}

export interface CanvasStore {
  getAll(): readonly Memo[];
  replaceAll(memos: Memo[]): void;
}

/**
 * ログイン直後に1回呼ぶ。サーバーに保存済みならローカルをそれで上書きし、
 * 無ければ今のローカルの内容をアップロードして初期バックアップにする。
 */
export async function syncOnSignIn(store: CanvasStore): Promise<void> {
  try {
    const remote = await pullCanvas();
    if (remote) {
      store.replaceAll(remote);
    } else {
      await pushCanvasNow(store.getAll());
    }
  } catch (e) {
    console.error("[cloudSync] initial sync failed", e);
  }
}
