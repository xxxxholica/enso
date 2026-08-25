import { createFadeVisibility } from "./fadeVisibility";
import { formatDurationJa } from "./fade";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import type { SessionState, StartSessionOptions } from "./sharedCanvas";

const PHASE_LABEL: Record<SessionState["phase"], string> = {
  ideation: "①アイデア出し",
  discussion: "②議論",
  voting: "③採択・絞り込み",
};

/** 延長ボタン1回あたりの延長量。 */
const EXTEND_MS = 5 * 60 * 1000;

export interface SessionPanelCallbacks {
  onStart: (options: StartSessionOptions) => void;
  onAdvance: () => void;
  onExtend: (addMs: number) => void;
  onEnd: () => void;
}

/**
 * 共有キャンバスの「共同アイデア出し」セッション(issue #59)のフェーズ表示・
 * ルームマスター操作を担うパネル。ReviveInfoPillと同じく命令的なupdate()を
 * render()のたびに呼ぶ形にし、開閉はSharedRoomMenu/AppearanceSelectorと
 * 同じ.icon-anchor/.icon-popoverパターンをそのまま使う。
 *
 * ルームマスターでない参加者には、フェーズ名+残り時間だけを見せる静的な
 * 表示にする（操作ボタンは出さない）——セッションの開始・進行はルーム
 * マスターだけの操作という仕様のため。
 */
export class SessionPanel {
  private callbacks: SessionPanelCallbacks;

  private anchor!: HTMLElement;
  private trigger!: HTMLButtonElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private readonly closeRef = () => this.close();
  private open = false;

  private startForm!: HTMLElement;
  private phase1Input!: HTMLInputElement;
  private phase2Input!: HTMLInputElement;
  private phase3Input!: HTMLInputElement;
  private maxParticipantsInput!: HTMLInputElement;

  private activeControls!: HTMLElement;
  private phaseLabelEl!: HTMLElement;

  private isMaster = false;

  constructor(container: HTMLElement, callbacks: SessionPanelCallbacks) {
    this.callbacks = callbacks;
    this.buildDom(container);
  }

  private buildDom(container: HTMLElement): void {
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";
    this.anchor.hidden = true;

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "pill-btn session-panel-trigger";
    this.trigger.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.trigger);

    this.popover = document.createElement("div");
    this.popover.className = "session-panel-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.phaseLabelEl = document.createElement("p");
    this.phaseLabelEl.className = "shared-section-label";
    this.popover.appendChild(this.phaseLabelEl);

    // 未開始時: フェーズの長さ・上限人数を決めて開始する。
    this.startForm = document.createElement("div");
    this.startForm.className = "session-start-form";
    this.phase1Input = this.buildMinutesField(this.startForm, "①アイデア出し(分)", 5);
    this.phase2Input = this.buildMinutesField(this.startForm, "②議論(分)", 5);
    this.phase3Input = this.buildMinutesField(this.startForm, "③採択・絞り込み(分)", 5);
    this.maxParticipantsInput = this.buildNumberField(this.startForm, "参加人数の上限", 8, 1, 50);
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "pill-btn pill-btn--primary";
    startBtn.textContent = "セッションを開始";
    startBtn.addEventListener("click", () => {
      const phase1Ms = this.minutesToMs(this.phase1Input);
      const phase2Ms = this.minutesToMs(this.phase2Input);
      const phase3Ms = this.minutesToMs(this.phase3Input);
      const maxParticipants = Math.max(1, Math.round(Number(this.maxParticipantsInput.value) || 1));
      this.callbacks.onStart({ phase1Ms, phase2Ms, phase3Ms, maxParticipants });
      this.close();
    });
    this.startForm.appendChild(startBtn);
    this.popover.appendChild(this.startForm);

    // 進行中: 次のフェーズへ／延長／終了。
    this.activeControls = document.createElement("div");
    this.activeControls.className = "session-active-controls";
    const advanceBtn = document.createElement("button");
    advanceBtn.type = "button";
    advanceBtn.className = "pill-btn";
    advanceBtn.textContent = "次のフェーズへ";
    advanceBtn.addEventListener("click", () => this.callbacks.onAdvance());
    const extendBtn = document.createElement("button");
    extendBtn.type = "button";
    extendBtn.className = "pill-btn";
    extendBtn.textContent = "延長 +5分";
    extendBtn.addEventListener("click", () => this.callbacks.onExtend(EXTEND_MS));
    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "pill-btn";
    endBtn.textContent = "セッションを終了";
    endBtn.addEventListener("click", () => {
      this.callbacks.onEnd();
      this.close();
    });
    this.activeControls.append(advanceBtn, extendBtn, endBtn);
    this.popover.appendChild(this.activeControls);

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
  }

  private buildMinutesField(parent: HTMLElement, label: string, defaultMinutes: number): HTMLInputElement {
    return this.buildNumberField(parent, label, defaultMinutes, 1, 180);
  }

  private buildNumberField(parent: HTMLElement, label: string, defaultValue: number, min: number, max: number): HTMLInputElement {
    const row = document.createElement("label");
    row.className = "session-form-row";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(defaultValue);
    row.append(span, input);
    parent.appendChild(row);
    return input;
  }

  private minutesToMs(input: HTMLInputElement): number {
    const minutes = Math.max(1, Number(input.value) || 1);
    return minutes * 60 * 1000;
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openPopover();
  }

  private openPopover(): void {
    if (!this.isMaster) return;
    notifyOpen(this.closeRef);
    this.open = true;
    this.popover.hidden = false;
    this.popoverFade(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  /** ルーム切り替えなど、表示を続ける意味が無くなったタイミングで呼ぶ。 */
  reset(): void {
    this.close();
  }

  /** render()のたびに呼ぶ。isMasterはgetCurrentUser()?.id === ownerIdで判定した値を渡す。 */
  update(now: number, isMaster: boolean, session: SessionState | null): void {
    this.isMaster = isMaster;

    if (!session) {
      // 未開始: マスターだけがトリガーを持つ(=セッションを開始できる)。
      this.anchor.hidden = !isMaster;
      this.trigger.textContent = "セッションを開始";
      this.startForm.hidden = false;
      this.activeControls.hidden = true;
      this.phaseLabelEl.hidden = true;
      return;
    }

    this.anchor.hidden = false;
    const remaining = formatDurationJa(Math.max(0, session.phaseEndsAt - now));
    this.trigger.textContent = `${PHASE_LABEL[session.phase]} 残り${remaining}`;
    if (!isMaster) {
      // 非マスターは静的な表示のみ——ポップオーバーは開かせない。
      if (this.open) this.close();
      return;
    }
    this.startForm.hidden = true;
    this.activeControls.hidden = false;
    this.phaseLabelEl.hidden = false;
    this.phaseLabelEl.textContent = `現在: ${PHASE_LABEL[session.phase]}`;
  }
}
