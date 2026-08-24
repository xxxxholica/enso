import { createFadeVisibility, FADE_TRANSITION_MS } from "../fadeVisibility";
import { ICONS } from "../icons";
import { TutorialCanvas } from "./tutorialCanvas";

/**
 * 初回チュートリアル（円相の由来と、書く・消える・なぞって残す・手放すという
 * 一連の体験を、専用の仮想キャンバス上で辿らせる全画面ガイド）。
 * 唯一の既存の全画面モーダルであるtemplatePicker.tsの作法
 * （fixed+backdrop、role="dialog"、フォーカスの退避と復元、Escapeを
 * capture段で止める）をそのまま踏襲する。ただし誤操作でガイドから
 * 抜けてしまわないよう、背景クリックでは閉じない。
 *
 * 各ステップは「意味のあるモーションで進む場面」と「見せるだけの場面」の
 * どちらかに徹する（ユーザー指摘：意味のないクリックをさせない）。
 * - 一・三：実際に道具を選び、描く／円を描くように動かすと、その場で自動的に
 *   進む。次へボタンもタイムアウトによる救済もない（進めないのはガイド自体の
 *   問題として直す）。
 * - 二・四：そもそも操作させない自動再生の場面なので、時間経過だけが進行条件。
 * - 序・結：モーションのしようがない導入・締めの場面なので、素直に「はじめる」
 *   ボタンで進む（ユーザー指摘：無理に円へのタップを進行条件にするのは、
 *   意味のないクリックを増やすだけだった）。
 *
 * 文章は、円相の由来を語る短い一文（.tutorial-body）と、今すること単体を
 * 指示する一文（.tutorial-body--instruction、太字＋アクセント色）を明確に
 * 分ける（ユーザー指摘：ポエムが続き、何をすればいいか分かりにくい）。
 * 見出し・キャンバス・道具バー・本文・補足・ボタンの各領域は、内容の有無に
 * かかわらず常に同じ高さを確保する（ユーザー指摘：ステップごとにウィンドウの
 * 大きさが変わってしまう）——ボタンや補足は「非表示」ではなく透明化して
 * 領域だけ残す。
 *
 * 道具（ペン／選択）は、ステップ側が自動で切り替えない——選択ツールで掴んで
 * 円を描くと時間が戻る、という最も伝わりにくい操作を、実際に道具バーから
 * 「選択」を選ぶところから自分の手で辿らせるため（ユーザー指示）。道具バーの
 * 見た目・アイコンは実物のtoolbar.ts/icons.tsと同じクラス・アイコンを使い、
 * 本番の操作感そのままにする。
 */

type StepKey = "intro" | "write" | "fade" | "revive" | "release" | "close";
type Tool = "pen" | "move";

const STEP_ORDER: StepKey[] = ["intro", "write", "fade", "revive", "release", "close"];

const MARKER: Record<StepKey, string> = {
  intro: "序",
  write: "一",
  fade: "二",
  revive: "三",
  release: "四",
  close: "結",
};

const TITLE: Record<StepKey, string> = {
  intro: "円相（えんそう）",
  write: "思いつきを、そのまま",
  fade: "完成を、目指さない",
  revive: "もう一度、円を描く",
  release: "生き残った一枚を、次へ",
  close: "円相",
};

/** 円相の由来を語る短い一文。ステップの主目的が「見せる」ことの場面でだけ使う。 */
const BODY: Partial<Record<StepKey, string>> = {
  intro: "一筆で描く円相。禅の書画で、悟りやその瞬間の完全性を表すとされます。",
  fade: "円相は、完成を目指しません。消えていくことも、この一枚のうちです。",
  release: "残った、本当に大切な一枚だけを、次の場所へ渡せるようになります。",
  close: "一筆の円は、悟りでも完成でもなく、その瞬間だけの完全さです。",
};

/** 今すること単体を指示する一文。ステップの主目的が「動いてもらう」場面でだけ使う。 */
const INSTRUCTION: Partial<Record<StepKey, string>> = {
  write: "道具バーで「ペン」を選び、円の中に描いてください。",
};

const INSTRUCTION_REVIVE_PICK = "道具バーで「選択」を選んでください。";
const INSTRUCTION_REVIVE_ACT = "光っている一枚を、円を描くように動かしてください。";

const NOTE: Partial<Record<StepKey, string>> = {
  write: "描き終えると、自動で次に進みます。",
  fade: "実際には約1日をかけて薄れていきます（ここでは数秒に圧縮しています）。",
  release: "画像として書き出す機能は近日公開予定です。",
};

const NOTE_REVIVE_PICK = "選ぶと、光っている一枚が見えるようになります。";
const NOTE_REVIVE_ACT = "うまく円を描けると、自動で次に進みます。";

const PRIMARY_LABEL: Partial<Record<StepKey, string>> = {
  intro: "はじめる",
  close: "はじめる",
};

/** 「二」「四」は操作させない自動再生の場面なので、時間経過だけが進行条件になる。 */
const AUTO_ADVANCE_MS: Partial<Record<StepKey, number>> = {
  fade: 3400,
  release: 3400,
};

/** モーションが完了してから次へ進むまでの、結果を目に焼き付けるための短い間。 */
const SUCCESS_PAUSE_MS = 550;

export function openTutorialOverlay(onComplete: () => void): void {
  new TutorialOverlay(onComplete);
}

class TutorialOverlay {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private setVisible: (show: boolean) => void;
  private markerEl: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private noteEl: HTMLElement;
  private skipBtn: HTMLButtonElement;
  private primaryBtn: HTMLButtonElement;
  private canvasWrap: HTMLElement;
  private tutorialCanvas: TutorialCanvas;
  private penBtn: HTMLButtonElement;
  private moveBtn: HTMLButtonElement;

  private step: StepKey = "intro";
  private reviveTargetId: string | null = null;
  /** ステップ「三」で、既に「選択」を選び終えたか（案内文の段階を進めるため）。 */
  private moveToolPicked = false;
  private lastFocused: HTMLElement | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private onComplete: () => void;

  constructor(onComplete: () => void) {
    this.onComplete = onComplete;

    this.root = document.createElement("div");
    this.root.className = "tutorial-overlay fade-visible";

    this.sheet = document.createElement("section");
    this.sheet.className = "tutorial-sheet";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-labelledby", "tutorial-title");
    this.sheet.tabIndex = -1;
    this.root.appendChild(this.sheet);

    const head = document.createElement("div");
    head.className = "tutorial-head";
    this.markerEl = document.createElement("span");
    this.markerEl.className = "tutorial-marker";
    this.skipBtn = document.createElement("button");
    this.skipBtn.type = "button";
    this.skipBtn.className = "tutorial-skip";
    this.skipBtn.textContent = "スキップ";
    this.skipBtn.addEventListener("click", () => this.finish());
    head.append(this.markerEl, this.skipBtn);
    this.sheet.appendChild(head);

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "tutorial-canvas-wrap";
    this.sheet.appendChild(this.canvasWrap);

    // 実物のtoolbar.ts（.toolbar-tools.control-block > .toolbar-pill > .toolbar-btn）
    // と同じクラス構成にし、見た目・当たり判定を本番と揃える。ここでは「ペン」
    // 「選択」の2つだけを、ステップに応じて自分で選ばせる。常に同じ場所に
    // 同じ大きさで表示し続ける（無効なステップでは薄く・押せなくするだけ）。
    const toolbarBlock = document.createElement("div");
    toolbarBlock.className = "toolbar-tools control-block tutorial-toolbar";
    const pill = document.createElement("div");
    pill.className = "toolbar-pill";
    this.penBtn = this.buildToolButton("pen", ICONS.pen, "ペン");
    this.moveBtn = this.buildToolButton("move", ICONS.move, "選択");
    pill.append(this.penBtn, this.moveBtn);
    toolbarBlock.appendChild(pill);
    this.sheet.appendChild(toolbarBlock);

    this.titleEl = document.createElement("h2");
    this.titleEl.className = "tutorial-title";
    this.titleEl.id = "tutorial-title";
    this.bodyEl = document.createElement("p");
    this.bodyEl.className = "tutorial-body";
    this.noteEl = document.createElement("p");
    this.noteEl.className = "tutorial-note";
    this.sheet.append(this.titleEl, this.bodyEl, this.noteEl);

    const actions = document.createElement("div");
    actions.className = "tutorial-actions";
    this.primaryBtn = document.createElement("button");
    this.primaryBtn.type = "button";
    this.primaryBtn.className = "pill-btn tutorial-primary";
    this.primaryBtn.addEventListener("click", () => this.advance());
    actions.appendChild(this.primaryBtn);
    this.sheet.appendChild(actions);

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);

    this.tutorialCanvas = new TutorialCanvas(this.canvasWrap);
    this.tutorialCanvas.onStrokeCommitted(() => this.handleStrokeCommitted());
    this.tutorialCanvas.onMemoRevived(() => this.handleRevived());

    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener("keydown", this.onKeyDown, true);
    this.setVisible(true);
    requestAnimationFrame(() => this.sheet.focus());

    this.enterStep("intro");
  }

  private buildToolButton(tool: Tool, icon: string, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toolbar-btn";
    btn.innerHTML = icon;
    btn.setAttribute("aria-label", label);
    btn.dataset.active = "false";
    btn.addEventListener("click", () => this.selectTool(tool));
    return btn;
  }

  private selectTool(tool: Tool): void {
    if (this.penBtn.disabled) return;
    this.tutorialCanvas.setTool(tool);
    this.penBtn.dataset.active = String(tool === "pen");
    this.moveBtn.dataset.active = String(tool === "move");
    this.penBtn.classList.remove("tutorial-tool-hint");
    this.moveBtn.classList.remove("tutorial-tool-hint");

    if (this.step === "revive" && tool === "move" && !this.moveToolPicked) {
      this.moveToolPicked = true;
      this.tutorialCanvas.highlightMemo(this.reviveTargetId);
      this.setInstruction(INSTRUCTION_REVIVE_ACT, NOTE_REVIVE_ACT);
    }
  }

  private setToolbarEnabled(enabled: boolean): void {
    this.penBtn.disabled = !enabled;
    this.moveBtn.disabled = !enabled;
  }

  /** 道具の選択を白紙に戻す（ステップ「一」「三」の開始時、毎回自分で選び直させる）。 */
  private resetToolSelection(): void {
    this.tutorialCanvas.setTool(null);
    this.penBtn.dataset.active = "false";
    this.moveBtn.dataset.active = "false";
  }

  /** 「動いてもらう」文言（太字＋アクセント色）に切り替える。 */
  private setInstruction(text: string, note: string): void {
    this.bodyEl.textContent = text;
    this.bodyEl.classList.add("tutorial-body--instruction");
    this.noteEl.textContent = note;
    this.noteEl.style.visibility = "visible";
  }

  /** 「見せる」文言（円相の由来を語る一文）に切り替える。 */
  private setNarrative(text: string, note: string | undefined): void {
    this.bodyEl.textContent = text;
    this.bodyEl.classList.remove("tutorial-body--instruction");
    this.noteEl.textContent = note ?? "";
    this.noteEl.style.visibility = note ? "visible" : "hidden";
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key === "Escape") this.finish();
  };

  private handleStrokeCommitted(): void {
    if (this.step !== "write") return;
    this.stepTimer = window.setTimeout(() => this.advance(), SUCCESS_PAUSE_MS);
  }

  private handleRevived(): void {
    if (this.step !== "revive") return;
    this.stepTimer = window.setTimeout(() => this.advance(), SUCCESS_PAUSE_MS);
  }

  private clearStepTimer(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = null;
  }

  private enterStep(step: StepKey): void {
    this.clearStepTimer();
    this.step = step;
    this.markerEl.textContent = MARKER[step];
    this.titleEl.textContent = TITLE[step];
    this.penBtn.classList.remove("tutorial-tool-hint");
    this.moveBtn.classList.remove("tutorial-tool-hint");
    this.setToolbarEnabled(false);
    this.tutorialCanvas.setInteractive(false);

    const primaryLabel = PRIMARY_LABEL[step];
    this.primaryBtn.textContent = primaryLabel ?? "";
    this.primaryBtn.style.visibility = primaryLabel ? "visible" : "hidden";

    const narrative = BODY[step];
    if (narrative !== undefined) this.setNarrative(narrative, NOTE[step]);

    if (step === "write") {
      this.setToolbarEnabled(true);
      this.tutorialCanvas.setInteractive(true);
      this.resetToolSelection();
      this.tutorialCanvas.highlightMemo(null);
      this.penBtn.classList.add("tutorial-tool-hint");
      this.setInstruction(INSTRUCTION.write!, NOTE.write!);
    } else if (step === "fade") {
      this.tutorialCanvas.highlightMemo(null);
      this.reviveTargetId = this.tutorialCanvas.firstMemoId();
    } else if (step === "revive") {
      this.setToolbarEnabled(true);
      this.tutorialCanvas.setInteractive(true);
      this.resetToolSelection();
      this.tutorialCanvas.highlightMemo(null);
      this.moveToolPicked = false;
      this.moveBtn.classList.add("tutorial-tool-hint");
      this.setInstruction(INSTRUCTION_REVIVE_PICK, NOTE_REVIVE_PICK);
    } else if (step === "release") {
      this.tutorialCanvas.highlightMemo(this.reviveTargetId);
    } else if (step === "close") {
      this.tutorialCanvas.highlightMemo(null);
    }

    const autoMs = AUTO_ADVANCE_MS[step];
    if (autoMs) this.stepTimer = window.setTimeout(() => this.advance(), autoMs);
  }

  private advance(): void {
    const next = STEP_ORDER[STEP_ORDER.indexOf(this.step) + 1];
    if (next) this.enterStep(next);
    else this.finish();
  }

  private finish(): void {
    this.clearStepTimer();
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    window.setTimeout(() => {
      this.tutorialCanvas.destroy();
      this.root.remove();
    }, FADE_TRANSITION_MS);
    this.lastFocused?.focus();
    this.onComplete();
  }
}
