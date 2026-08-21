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
 * - 他端末で変更があったときは、realtimeSync.ts経由の通知を受けてrefreshFromCloud()で取得し直す。
 *
 * スコープ外（今回はやらないこと。コラボ機能側の課題）:
 * - 複数端末・複数人での同時編集や競合解決。ここでは「最後に同期した内容で丸ごと上書き」という
 *   単純な方式のみ。同時に複数端末から使うと、後から同期した方が勝つ。
 */

const PUSH_DEBOUNCE_MS = 2000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;

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

/** 自分が最後にサーバーへ送った（または取得した）内容のスナップショット。自分のpushが
 *  自分の元に通知として返ってきたとき、同じ内容ならreplaceAllし直さないための判定に使う。 */
let lastSyncedJson: string | null = null;

async function pushCanvasNow(memos: readonly Memo[]): Promise<void> {
  const json = JSON.stringify(memos);
  const res = await authFetch("/canvas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memos }),
  });
  if (!res.ok) throw new Error(`クラウドへの保存に失敗しました (status: ${res.status})`);
  lastSyncedJson = json;
}

let pushInFlight = false;

export function schedulePush(memos: readonly Memo[]): void {
  if (!isSignedIn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    pushInFlight = true;
    void pushCanvasNow(memos)
      .catch((e) => {
        console.error("[cloudSync] push failed", e);
      })
      .finally(() => {
        pushInFlight = false;
      });
  }, PUSH_DEBOUNCE_MS);
}

/** ローカルにまだサーバーへ送信していない変更が残っているか（送信待ち、または送信中）。 */
export function hasPendingLocalChanges(): boolean {
  return pushTimer !== undefined || pushInFlight;
}

export interface CanvasStore {
  getAll(): readonly Memo[];
  replaceAll(memos: Memo[]): void;
}

export async function syncOnSignIn(store: CanvasStore): Promise<void> {
  try {
    const remote = await pullCanvas();
    if (remote) {
      lastSyncedJson = JSON.stringify(remote);
      store.replaceAll(remote);
    } else {
      await pushCanvasNow(store.getAll());
    }
  } catch (e) {
    console.error("[cloudSync] initial sync failed", e);
  }
}

/**
 * realtimeSync.ts から「サーバー側で変更があった」と通知されたときに呼ぶ、取得のみの再同期。
 */
export async function refreshFromCloud(store: CanvasStore): Promise<void> {
  if (hasPendingLocalChanges()) {
    console.log("[cloudSync] refresh skipped: local changes pending");
    return;
  }
  try {
    const remote = await pullCanvas();
    if (!remote) return;
    const remoteJson = JSON.stringify(remote);
    if (remoteJson === lastSyncedJson) {
      // 自分の変更が自分の元に通知として返ってきただけ。中身が同じなので何もしない。
      console.log("[cloudSync] refresh skipped: identical to last sync");
      return;
    }
    lastSyncedJson = remoteJson;
    store.replaceAll(remote);
  } catch (e) {
    console.error("[cloudSync] refresh failed", e);
  }
}
