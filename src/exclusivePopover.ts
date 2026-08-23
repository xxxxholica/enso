/**
 * ルーム作成・選択メニューと見た目の設定メニューなど、同じ場所（眼鏡キャンバス
 * の下）に並ぶ複数のポップアップは、同時に開いていると窮屈で分かりにくい
 * （ユーザー指摘）。どちらかを開いている時にもう一方を開こうとしたら、
 * 先に開いていた方を自動で閉じる——各メニュークラスは自分の閉じる関数を
 * 開く直前にnotifyOpen()へ渡すだけでよい。
 */
let activeClose: (() => void) | null = null;

export function notifyOpen(close: () => void): void {
  if (activeClose && activeClose !== close) activeClose();
  activeClose = close;
}

export function notifyClose(close: () => void): void {
  if (activeClose === close) activeClose = null;
}
