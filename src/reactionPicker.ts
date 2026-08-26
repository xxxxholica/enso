import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import type { Reaction } from "./types";

/**
 * issue #128: 共有ルームのリアクションスタンプ。円形キャンバス（canvasView.ts）は
 * メモを<canvas>の中に描画するため、メモごとに個別のDOM要素・ポップオーバー位置を
 * 持たせるのは難しい——代わりに、タップされたメモ1件ぶんの情報を画面下部の
 * シート（モバイルの下部ツールバーと同じ「画面下固定」の考え方、issue #103）に
 * まとめて出す方式にする。メモの位置（ズーム・レンズ分割・スクロールで常に変わる）
 * に追従させる座標計算が不要になり、実装・見た目とも単純になる。
 *
 * 1人1メモにつき1スタンプまで・変更不可（バックエンド仕様）なので、押した後は
 * ボタンを押せなくする。「誰が押したかは実名で表示する」(issue決定事項)ため、
 * emojiごとに押した人の表示名を並べて見せる(renderReactionSummary、db.jsの
 * JOINでサーバーがdisplayNameを解決して返す)。ただし「自分が既にどれを押したか
 * (=送信済みボタンのうちどれが自分の選択か)」はサーバー側のuserIdでしか
 * 判定できずゲストの自分のuserIdをフロントが持っていないため、この画面内では
 * 「押した/押していない」の二値までしか出さない（正確な自分の選択の可視化は、
 * ゲストの自分のuserId自体をフロントに持たせる別途対応が必要——最終サマリ参照）。
 */

export interface ReactionPickerCallbacks {
  onPick: (memoId: string, emoji: string) => void;
}

export class ReactionPicker {
  private overlay: HTMLElement;
  private sheet: HTMLElement;
  private titleEl: HTMLElement;
  private buttonsEl: HTMLElement;
  private summaryEl: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private fade: (show: boolean) => void;
  private readonly closeRef = () => this.close();
  private isOpen = false;
  private currentMemoId: string | null = null;
  private callbacks: ReactionPickerCallbacks;

  constructor(container: HTMLElement, callbacks: ReactionPickerCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement("div");
    this.overlay.className = "reaction-picker-overlay";
    this.overlay.hidden = true;
    // シートの外側（暗い背景部分）をタップしたら閉じる。
    this.overlay.addEventListener("click", (ev) => {
      if (ev.target === this.overlay) this.close();
    });

    this.sheet = document.createElement("div");
    this.sheet.className = "reaction-picker-sheet";
    this.overlay.appendChild(this.sheet);

    const header = document.createElement("div");
    header.className = "reaction-picker-header";
    this.titleEl = document.createElement("p");
    this.titleEl.className = "reaction-picker-title";
    header.appendChild(this.titleEl);
    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "reaction-picker-close";
    this.closeBtn.textContent = "×";
    this.closeBtn.setAttribute("aria-label", "閉じる");
    this.closeBtn.addEventListener("click", () => this.close());
    header.appendChild(this.closeBtn);
    this.sheet.appendChild(header);

    this.buttonsEl = document.createElement("div");
    this.buttonsEl.className = "reaction-picker-buttons";
    this.sheet.appendChild(this.buttonsEl);

    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "reaction-picker-summary";
    this.sheet.appendChild(this.summaryEl);

    this.fade = createFadeVisibility(this.overlay);
    container.appendChild(this.overlay);
  }

  /** メモをタップした時に呼ぶ。allowedEmojiは今のフェーズで押せるスタンプの種類
   *  （sharedCanvas.REACTION_EMOJI/VOTING_EMOJI参照）、alreadyReactedはこの
   *  クライアントが今セッション中に既にこのメモへ送信済みかどうか。 */
  open(memoId: string, label: string, allowedEmoji: readonly string[], reactions: Reaction[], alreadyReacted: boolean): void {
    this.currentMemoId = memoId;
    notifyOpen(this.closeRef, this.overlay);
    this.titleEl.textContent = label;

    this.buttonsEl.innerHTML = "";
    for (const emoji of allowedEmoji) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reaction-picker-emoji-btn";
      btn.textContent = emoji;
      btn.disabled = alreadyReacted;
      btn.addEventListener("click", () => {
        if (!this.currentMemoId) return;
        this.callbacks.onPick(this.currentMemoId, emoji);
      });
      this.buttonsEl.appendChild(btn);
    }

    renderReactionSummary(this.summaryEl, reactions, alreadyReacted);

    this.isOpen = true;
    this.overlay.hidden = false;
    this.fade(true);
  }

  /** 送信結果を受け取って表示を更新する（送信中に閉じられていなければ）。
   *  成功・409(既に送信済み)いずれでも、以後はこのメモへ再送信できないよう
   *  ボタンを無効化する。 */
  markReacted(memoId: string, reactions: Reaction[]): void {
    if (!this.isOpen || this.currentMemoId !== memoId) return;
    for (const btn of Array.from(this.buttonsEl.children)) {
      (btn as HTMLButtonElement).disabled = true;
    }
    renderReactionSummary(this.summaryEl, reactions, true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.currentMemoId = null;
    this.fade(false);
    notifyClose(this.closeRef);
  }
}

/** 「誰が押したかは実名で表示する」(issue #128の決定事項)。emojiごとに
 *  押した人の表示名を並べる（例: 「👍 太郎さん、花子さん」）。displayNameが
 *  未解決(null)のリアクションは、この機能導入前から参加済みだったClerkメンバー
 *  由来の可能性がある(joinAsMemberのコメント参照)ため「名前未設定」で表示する。 */
function renderReactionSummary(container: HTMLElement, reactions: Reaction[], alreadyReacted: boolean): void {
  container.innerHTML = "";
  if (reactions.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "まだリアクションがありません";
    container.appendChild(empty);
    return;
  }
  const byEmoji = new Map<string, Reaction[]>();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji)!.push(r);
  }
  for (const [emoji, group] of byEmoji) {
    const line = document.createElement("p");
    line.className = "reaction-picker-summary-line";
    const names = group.map((r) => `${r.displayName ?? "名前未設定"}さん`).join("、");
    line.textContent = `${emoji} ${names}`;
    container.appendChild(line);
  }
  if (alreadyReacted) {
    const note = document.createElement("p");
    note.className = "reaction-picker-summary-note";
    note.textContent = "あなたはリアクション済みです";
    container.appendChild(note);
  }
}
