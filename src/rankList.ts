import type { Memo, TextMemo } from "./types";

/**
 * issue #128: 序列づけ(rank)フェーズ専用の表示。「本文を見せずタイトルのみを
 * 並べ、短時間でリアクションスタンプによる関心の一次選別を行う」という決定事項
 * のため、この間だけ円形キャンバスの代わりにタイトルの一覧を表示する
 * （StrokeMemo(描画のみ)はこのフェーズの対象外、そのままdiscussionへ持ち越す
 * ——一覧にも出さない）。
 *
 * ランキングはスタンプ種別を重み付けせず単純な合計数で算出する(issue決定事項)
 * ——同じ考え方をここでの並び順にもそのまま使う。行をタップすると、
 * smuiView.tsのReactionPicker(他フェーズと共通のUI)が開く。
 */
export class RankList {
  private el: HTMLElement;
  private onTapMemo: (memoId: string) => void;
  private visible = false;

  constructor(container: HTMLElement, onTapMemo: (memoId: string) => void) {
    this.onTapMemo = onTapMemo;
    this.el = document.createElement("div");
    this.el.className = "rank-list";
    this.el.hidden = true;
    container.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
  }

  /** rankフェーズ中、対象メモ(StrokeMemoを除く)が変わるたびに呼ぶ
   *  （メモの新規作成・削除、リアクションの追加）。非表示中は無駄なDOM構築を
   *  避けるため何もしない。 */
  update(memos: readonly Memo[]): void {
    if (!this.visible) return;
    const targets = memos.filter((m): m is TextMemo => m.kind === "text");
    const ranked = targets
      .map((memo) => ({ memo, count: (memo.reactions ?? []).length }))
      .sort((a, b) => b.count - a.count || a.memo.createdAt - b.memo.createdAt);

    this.el.innerHTML = "";
    if (ranked.length === 0) {
      const empty = document.createElement("p");
      empty.className = "rank-list-empty";
      empty.textContent = "対象のメモがありません（描画メモは序列づけの対象外です）";
      this.el.appendChild(empty);
      return;
    }
    for (const { memo, count } of ranked) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "rank-list-row";
      const titleEl = document.createElement("span");
      titleEl.className = "rank-list-row-title";
      titleEl.textContent = rankListTitle(memo);
      const countEl = document.createElement("span");
      countEl.className = "rank-list-row-count";
      countEl.textContent = count > 0 ? String(count) : "";
      row.append(titleEl, countEl);
      row.addEventListener("click", () => this.onTapMemo(memo.id));
      this.el.appendChild(row);
    }
  }
}

function rankListTitle(memo: TextMemo): string {
  const title = memo.title?.trim();
  if (title) return title;
  const firstLine = memo.text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 ? firstLine : "(無題のメモ)";
}
