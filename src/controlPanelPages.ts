/**
 * スマホ幅では、下部バーの3ブロック（ツール選択／ツールの詳細／時間選択）を
 * 1つの表示領域にまとめ、上下スワイプ（＝縦スクロール、style.cssの
 * scroll-snapで実現）で切り替える（ユーザー指示）。このモジュールは
 * 「今どちらのページが見えているか」をスクロール位置から判定してドットの
 * 強調を切り替える橋渡しと、ドットをタップした時に該当ページへスクロールする
 * 処理だけを担う——ページ送り自体（スワイプの物理挙動）はCSSのscroll-snapに
 * 任せ、ここでJSによるドラッグ処理は行わない。
 *
 * デスクトップ幅（480px超）では.control-panel-pagesがdisplay:contentsになり
 * スクロールコンテナとして機能しなくなるため、scrollイベント自体が発生しない
 * ——このモジュールを常時呼び出しておいても何もしない、という前提で安全。
 */
export function setupControlPanelPages(pagesEl: HTMLElement, dotsEl: HTMLElement): void {
  const dots = [...dotsEl.querySelectorAll<HTMLButtonElement>(".control-panel-dot")];
  if (dots.length === 0) return;

  // ブラウザによっては、grid-template-areasで複数列にまたがる1段目
  // （.toolbar-tools）を持つscroll-snapコンテナの初期スクロール位置が、
  // 何も操作していないのに2段目にスナップしてしまうことがある（実機・
  // 自動テストで確認済み）。1段目を初期表示にしたいので、明示的に0へ戻す。
  pagesEl.scrollTop = 0;

  const syncActiveDot = () => {
    const pageIndex = Math.min(dots.length - 1, Math.round(pagesEl.scrollTop / pagesEl.clientHeight));
    dots.forEach((dot, i) => dot.classList.toggle("is-active", i === pageIndex));
  };

  pagesEl.addEventListener("scroll", syncActiveDot);
  syncActiveDot();

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      pagesEl.scrollTo({ top: i * pagesEl.clientHeight, behavior: "smooth" });
    });
  });
}
