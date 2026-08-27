import { notifyClose, notifyOpen } from "./exclusivePopover";
import type { Point, Reaction } from "./types";

/**
 * issue #128: 共有ルームのリアクションスタンプ。Teams/Discordのように、対象の
 * メモのすぐ近くに小さなパネルを浮かせてスタンプを押せるようにする
 * （ユーザー指示：画面下固定シートより要素の近くで完結する方が楽）。
 * canvasView.getMemoScreenPosition()でメモの代表座標を画面px(position:fixed
 * 基準)に変換し、その位置を基準に自分の大きさぶん収まるよう補正して配置する。
 *
 * ホバー・タップいずれでも同じ内容が開く(smuiView.ts)。ボタンはタップ後の
 * 確認ステップを挟まず、押した瞬間に送信する。1人1メモにつき1スタンプまで・
 * 変更不可（バックエンド仕様）なので、押した後はボタンを押せなくする。
 * 「誰が押したかは実名で表示する」(issue決定事項)ため、emojiごとに押した人の
 * 表示名をボタンの下に並べる(db.jsのJOINでサーバーがdisplayNameを解決して返す)。
 * ただし「自分が既にどれを押したか(=送信済みのうちどれが自分の選択か)」は
 * サーバー側のuserIdでしか判定できずゲストの自分のuserIdをフロントが持って
 * いないため、この画面内では「押した/押していない」の二値までしか出さない
 * （正確な自分の選択の可視化には、ゲスト自身のuserIdをフロントに持たせる
 * 別途対応が必要——最終サマリ参照）。
 */

export interface ReactionPickerCallbacks {
  onPick: (memoId: string, emoji: string) => void;
}

/** パネルと画面端の最小マージン(px)。 */
const VIEWPORT_MARGIN = 8;
/** パネルとアンカー点(メモの代表座標)の間の隙間(px)。 */
const ANCHOR_GAP = 14;

export class ReactionPicker {
  private el: HTMLElement;
  private buttonsEl: HTMLElement;
  private summaryEl: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private readonly closeRef = () => this.close();
  private isOpen = false;
  private currentMemoId: string | null = null;
  private callbacks: ReactionPickerCallbacks;

  constructor(container: HTMLElement, callbacks: ReactionPickerCallbacks) {
    this.callbacks = callbacks;

    this.el = document.createElement("div");
    this.el.className = "reaction-float";
    this.el.hidden = true;

    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "reaction-float-close";
    this.closeBtn.textContent = "×";
    this.closeBtn.setAttribute("aria-label", "閉じる");
    this.closeBtn.addEventListener("click", () => this.close());
    this.el.appendChild(this.closeBtn);

    this.buttonsEl = document.createElement("div");
    this.buttonsEl.className = "reaction-float-buttons";
    this.el.appendChild(this.buttonsEl);

    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "reaction-float-summary";
    this.el.appendChild(this.summaryEl);

    container.appendChild(this.el);
  }

  /** メモがタップ/ホバーされた時に呼ぶ。allowedEmojiは今のフェーズで押せる
   *  スタンプの種類（sharedCanvas.REACTION_EMOJI/VOTING_EMOJI参照）、
   *  alreadyReactedはこのクライアントが今セッション中に既にこのメモへ送信済み
   *  かどうか、anchorはcanvasView.getMemoScreenPosition()が返す画面座標。 */
  open(
    memoId: string,
    allowedEmoji: readonly string[],
    reactions: Reaction[],
    alreadyReacted: boolean,
    anchor: Point
  ): void {
    this.currentMemoId = memoId;
    notifyOpen(this.closeRef, this.el);

    this.buttonsEl.innerHTML = "";
    for (const emoji of allowedEmoji) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reaction-float-btn";
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
    this.el.hidden = false;
    this.reposition(anchor);
  }

  /** 開いたまま(ホバー継続中・パン/ズーム中)、アンカー位置を追従させる。
   *  中身は変えず位置だけ更新するので、毎フレーム呼んでも軽い。 */
  reposition(anchor: Point): void {
    if (!this.isOpen) return;
    const rect = this.el.getBoundingClientRect();
    let left = anchor.x - rect.width / 2;
    let top = anchor.y - rect.height - ANCHOR_GAP; // 既定: メモの上に浮かせる
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), window.innerWidth - rect.width - VIEWPORT_MARGIN);
    if (top < VIEWPORT_MARGIN) top = anchor.y + ANCHOR_GAP; // 上に収まらなければ下に出す
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), window.innerHeight - rect.height - VIEWPORT_MARGIN);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
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

  /** 今開いていて、かつanchorMemoIdの対象なら真。render()の追従判定に使う。 */
  isOpenFor(memoId: string): boolean {
    return this.isOpen && this.currentMemoId === memoId;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.currentMemoId = null;
    this.el.hidden = true;
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
    if (!alreadyReacted) return; // まだ何も無い・自分も未送信ならこの節自体を出さない(パネルを小さく保つ)
  } else {
    const byEmoji = new Map<string, Reaction[]>();
    for (const r of reactions) {
      if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
      byEmoji.get(r.emoji)!.push(r);
    }
    for (const [emoji, group] of byEmoji) {
      const line = document.createElement("p");
      line.className = "reaction-float-summary-line";
      const names = group.map((r) => `${r.displayName ?? "名前未設定"}さん`).join("、");
      line.textContent = `${emoji} ${names}`;
      container.appendChild(line);
    }
  }
  if (alreadyReacted) {
    const note = document.createElement("p");
    note.className = "reaction-float-summary-note";
    note.textContent = "リアクション済み";
    container.appendChild(note);
  }
}
