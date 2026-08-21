/**
 * サーバー(api.onunu.me)向けの認証付きfetchの共通実装。
 * ログイン状態やトークンの取得方法は clerkAccount.ts からの通知を受けて
 * cloudSync.setTokenGetter が差し替える。cloudSync.ts（個人キャンバス）・
 * sharedCanvas.ts（コラボ機能）の両方がここを経由する。
 */

const API_BASE = "https://api.onunu.me";

export type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

/** cloudSync.setTokenGetter からだけ呼ばれる内部用の更新関数。 */
export function _setApiTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

export function isSignedIn(): boolean {
  return tokenGetter !== null;
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!tokenGetter) throw new Error("未ログインです");
  const token = await tokenGetter();
  if (!token) throw new Error("セッションが取得できませんでした");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
