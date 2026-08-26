import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import type { SessionState, StartSessionOptions } from "./sharedCanvas";

export const PHASE_LABEL: Record<SessionState["phase"], string> = {
  ideation: "アイデア出し",
  discussion: "議論",
  voting: "採択・絞り込み",
};

/** 延長ボタン1回あたりの延長量。 */
const EXTEND_MS = 5 * 60 * 1000;

/** セッションの残り時間表示専用。fade.tsのformatDurationJaは複数日にまたがる
 *  長い猶予期間向けに一番大きい2単位だけを見せる作りで、数分〜数十分の
 *  フェーズの残り時間には粗すぎる（ユーザー指示：「4分20秒」のように秒まで
 *  見せたい）ため、ここだけ分・秒に絞った専用の書式にする。 */
function formatMinutesSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}秒`;
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
}

/** フェーズの長さ・参加人数上限のスライダー範囲。 */
const MINUTES_RANGE = { min: 1, max: 30, step: 1, default: 5 } as const;
// 上限は8——フェーズ①の色プール(smuiView.ts PARTICIPANT_COLORS)が色覚検証済みの
// 固定8色までしか用意していないため（検証の結果、色相だけを増やして人数分の
// 色を用意する方式は見分けが困難なペアが出ることが分かった）。
const MAX_PARTICIPANTS_RANGE = { min: 1, max: 8, step: 1, default: 8 } as const;

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
 * トリガーボタンは常に表示しておき、操作できない間（ルームマスターでない、
 * またはセッション未開始でマスターでもない）は.pill-btn:disabledの薄い表示に
 * する——招待リンク欄などこのアプリの既存の「隠すのではなく無効表示」という
 * 慣習に合わせる（ユーザー指示）。
 */
export class SessionPanel {
  private callbacks: SessionPanelCallbacks;

  private anchor!: HTMLElement;
  private trigger!: HTMLButtonElement;
  private triggerLabelEl!: HTMLElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private readonly closeRef = () => this.close();
  private open = false;

  private startForm!: HTMLElement;
  private phase1Slider!: HTMLInputElement;
  private phase2Slider!: HTMLInputElement;
  private phase3Slider!: HTMLInputElement;
  private maxParticipantsSlider!: HTMLInputElement;

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

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "pill-btn session-panel-trigger";
    this.trigger.innerHTML = ICONS.timer;
    this.triggerLabelEl = document.createElement("span");
    this.trigger.appendChild(this.triggerLabelEl);
    this.trigger.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.trigger);

    this.popover = document.createElement("div");
    this.popover.className = "session-panel-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.phaseLabelEl = document.createElement("p");
    this.phaseLabelEl.className = "shared-section-label";
    this.popover.appendChild(this.phaseLabelEl);

    // 未開始時: フェーズの長さ・上限人数をスライダーで決めて開始する。
    this.startForm = document.createElement("div");
    this.startForm.className = "session-start-form";
    this.phase1Slider = this.buildSlider(this.startForm, PHASE_LABEL.ideation, MINUTES_RANGE, "分");
    this.phase2Slider = this.buildSlider(this.startForm, PHASE_LABEL.discussion, MINUTES_RANGE, "分");
    this.phase3Slider = this.buildSlider(this.startForm, PHASE_LABEL.voting, MINUTES_RANGE, "分");
    this.maxParticipantsSlider = this.buildSlider(this.startForm, "参加人数の上限", MAX_PARTICIPANTS_RANGE, "人");
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "pill-btn pill-btn--primary";
    startBtn.textContent = "セッションを開始";
    startBtn.addEventListener("click", () => {
      this.callbacks.onStart({
        phase1Ms: Number(this.phase1Slider.value) * 60 * 1000,
        phase2Ms: Number(this.phase2Slider.value) * 60 * 1000,
        phase3Ms: Number(this.phase3Slider.value) * 60 * 1000,
        maxParticipants: Number(this.maxParticipantsSlider.value),
      });
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
    advanceBtn.addEventListener("click", () => {
      this.callbacks.onAdvance();
      this.close();
    });
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

  /** ラベルと現在値を同じ行の両端に置き（左:ラベル、右:現在値）、その下に
   *  全幅のスライダーを敷く1項目分の行を作る（ユーザー指示：現在値はスライダーの
   *  タイトルの真横ではなく右上に見せたい）。 */
  private buildSlider(
    parent: HTMLElement,
    label: string,
    range: { min: number; max: number; step: number; default: number },
    unit: string
  ): HTMLInputElement {
    const row = document.createElement("div");
    row.className = "session-form-row";

    const header = document.createElement("div");
    header.className = "session-form-header";
    const labelEl = document.createElement("span");
    labelEl.className = "session-form-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "session-form-value";
    header.append(labelEl, valueEl);
    row.appendChild(header);

    const input = document.createElement("input");
    input.type = "range";
    input.className = "session-slider";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(range.default);
    input.setAttribute("aria-label", label);
    const sync = () => {
      valueEl.textContent = `${input.value}${unit}`;
    };
    input.addEventListener("input", sync);
    sync();
    row.appendChild(input);
    parent.appendChild(row);
    return input;
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
      // 未開始: 誰でも見えるが、マスターでなければ押せない（招待リンク欄などと
      // 同じ、隠すのではなく無効表示にする慣習）。
      this.trigger.disabled = !isMaster;
      this.triggerLabelEl.textContent = "セッションを開始";
      this.startForm.hidden = false;
      this.activeControls.hidden = true;
      this.phaseLabelEl.hidden = true;
      return;
    }

    const remaining = formatMinutesSeconds(session.phaseEndsAt - now);
    this.triggerLabelEl.textContent = `${PHASE_LABEL[session.phase]} ${remaining}`;
    this.trigger.disabled = !isMaster;
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
