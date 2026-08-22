/**
 * 共有キャンバスの名前は、バックエンド(api.onunu.me)がまだ保存に対応していないため
 * (Cannot PATCH — 2026-08-22に確認)、この端末のlocalStorageだけに保存する。
 * 他の参加者や他端末には見えない、あくまで自分用のラベル。
 */

const STORAGE_KEY = "sharedCanvasNicknames";

function loadAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getNickname(id: string): string | null {
  const value = loadAll()[id];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function setNickname(id: string, name: string): void {
  const all = loadAll();
  const trimmed = name.trim();
  if (trimmed) {
    all[id] = trimmed;
  } else {
    delete all[id];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
