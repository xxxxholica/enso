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
 * ボタンを押せなくする。「自分が既にどれを押したか」はサーバー側のuserIdでしか
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

    this.summaryEl = document.createElement("p");
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

    this.summaryEl.textContent = summarizeReactions(reactions, alreadyReacted);

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
    this.summaryEl.textContent = summarizeReactions(reactions, true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.currentMemoId = null;
    this.fade(false);
    notifyClose(this.closeRef);
  }
}

/** 集計を「👍3 😱1」のように短くまとめる。実名の一覧は数が増えると読みにくく
 *  なるため、ここでは合計数のみ表示する（issue決定事項の「リアルタイム公開」＝
 *  誰でも見えることは満たしつつ、実名一覧はホバー等の別UIに譲る想定）。 */
function summarizeReactions(reactions: Reaction[], alreadyReacted: boolean): string {
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(([emoji, count]) => `${emoji}${count}`);
  const summary = parts.length > 0 ? parts.join(" ") : "まだリアクションがありません";
  return alreadyReacted ? `${summary}（あなたはリアクション済み）` : summary;
}
