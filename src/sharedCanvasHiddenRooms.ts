/**
 * 共有キャンバスの「削除」は、バックエンドに退出・削除のAPIがまだ無いため
 * (2026-08-24確認: DELETE /shared-canvases/:id、POST /shared-canvases/:id/leave
 * ともに404で未実装)、この端末の一覧からだけ非表示にする形で実現する。
 * ルーム自体はサーバー・他の参加者の一覧には残ったままで、招待リンクを
 * 知っていれば再度参加できる。sharedCanvasNicknames.tsと同じ方針。
 */

const STORAGE_KEY = "sharedCanvasHiddenRooms";

function loadHidden(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function isRoomHidden(id: string): boolean {
  return loadHidden().includes(id);
}

export function hideRoom(id: string): void {
  const hidden = loadHidden();
  if (hidden.includes(id)) return;
  hidden.push(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Safariのプライベートブラウズ等、書き込みが例外を投げる環境でも
    // 呼び出し元（削除ボタンのクリックハンドラ）の後続処理を止めない。
  }
}
