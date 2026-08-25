import { createFadeVisibility } from "./fadeVisibility";
import { TutorialSandbox } from "./tutorialSandbox";

/**
 * 使い方ページ：円相の由来と基本操作を、序・練・結の一続きの読み物＋体験として
 * 見せる全画面の静的ページ。序と結は読み物のまま、中間の「練」だけは本物の
 * CircularCanvasを再利用した練習用サンドボックス（tutorialSandbox.ts）——
 * 掴んで回す・振り返りスライダーの2つの時間操作を、実際に手を動かして
 * 体験できる。
 *
 * 以前は本物のキャンバス・本物のstoreをそのまま流用してチュートリアルにしていたが、
 * ①本物のCircularCanvasは外からrequestAnimationFrameでrender()を呼び続けないと
 * 何も描かれない、②裏に隠れているだけの本物のキャンバスがwindow単位の
 * ブラインドタイピングを拾って実データに書き込んでしまう、といった不具合が
 * 繰り返し起き、実装・保守のコストがリターンに見合わなくなったため一度撤廃した
 * （読み物だけの静的ページに置き換えた経緯）。今回の「練」は、この2つの不具合を
 * 構造的に防げる形で作り直したもの——CircularCanvasクラス自体は再利用しつつ、
 * 専用の使い捨てMemoStore・自前のrequestAnimationFrameループを持たせ（①の対策）、
 * このページ自身がcapture段で全キー入力をstopPropagationして本物のonGlobalKeyDown
 * （ブラインドタイピング）に一切渡さない（②の対策。詳しくはtutorialSandbox.tsの
 * クラスコメント参照）。
 *
 * 全画面モーダルの骨格・フォーカスの作法はtemplatePicker.tsに揃える。
 * Escapeキーを含む全キー入力をcapture段でstopPropagationするのも
 * templatePicker.tsと同じ理由——このページ自身（練のサンドボックスを含む）は
 * テキスト入力を一切持たないため安全に全キーを止められる。
 */

interface Stage {
  marker: string;
  title: string;
  body: string;
  anim: "intro" | "close";
}

const INTRO_STAGE: Stage = {
  marker: "序",
  title: "円相（えんそう）",
  anim: "intro",
  body: "一筆で描く円相。禅の書画で、悟りやその瞬間の完全性を表すとされます。この一枚も、同じように一筆で生まれ、同じように消えていきます。",
};

const CLOSING_STAGE: Stage = {
  marker: "結",
  title: "円相",
  anim: "close",
  body: "一筆の円は、悟りでも完成でもなく、その瞬間だけの完全さ。今、本当に大事なものだけが、ここに残ります。",
};

let overlay: UsageGuide | null = null;

/** onCloseは、閉じた（スキップ含む）直後に一度だけ呼ばれる——初回だけこの後に
 *  テンプレート選択へ続けるため（main.ts参照）。ヘッダーからの再視聴時は省略する。 */
export function openUsageGuide(onClose?: () => void): void {
  if (!overlay) overlay = new UsageGuide();
  overlay.open(onClose);
}

class UsageGuide {
  private root: HTMLElement;
  private sheet: HTMLElement;
  private setVisible: (show: boolean) => void;
  private opened = false;
  private lastFocused: HTMLElement | null = null;
  private canvases: HTMLCanvasElement[] = [];
  private raf = 0;
  private onClose: (() => void) | null = null;
  private sandbox: TutorialSandbox | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "usage-guide fade-visible";
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", (ev) => {
      if (ev.target === this.root) this.close();
    });

    this.sheet = document.createElement("section");
    this.sheet.className = "usage-guide-sheet";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-labelledby", "usage-guide-title");
    this.sheet.tabIndex = -1;
    this.root.appendChild(this.sheet);

    this.buildContent();

    this.setVisible = createFadeVisibility(this.root);
    document.body.appendChild(this.root);
  }

  private buildContent(): void {
    // ✕ボタンをheadの中に入れ、head自体をスクロール中も上部に固定する
    // （template-picker.tsのbuildHeadと同じ構成——ユーザー指摘：下へスクロール
    // した後、閉じるのに上まで戻らないといけないのはUI/UX上良くない）。
    const head = document.createElement("header");
    head.className = "usage-guide-head";

    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "usage-guide-title";
    title.className = "usage-guide-title";
    title.textContent = "円相";
    const lede = document.createElement("p");
    lede.className = "usage-guide-lede";
    lede.textContent =
      "書いたものが、ゆっくり消えていく円のキャンバスです。消えることは不具合ではなく、このアプリの考え方そのものです。";
    heading.append(title, lede);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "usage-guide-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());

    head.append(heading, closeBtn);
    this.sheet.appendChild(head);

    const storyboard = document.createElement("div");
    storyboard.className = "usage-guide-storyboard";
    storyboard.appendChild(this.buildStage(INTRO_STAGE));
    storyboard.appendChild(this.buildPracticeStage());
    storyboard.appendChild(this.buildStage(CLOSING_STAGE));
    this.sheet.appendChild(storyboard);

    const actions = document.createElement("div");
    actions.className = "usage-guide-actions";
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "pill-btn";
    startBtn.textContent = "はじめる";
    startBtn.addEventListener("click", () => this.close());
    actions.appendChild(startBtn);
    this.sheet.appendChild(actions);
  }

  private buildStage(stage: Stage): HTMLElement {
    const el = document.createElement("div");
    el.className = "usage-guide-stage";

    const marker = document.createElement("div");
    marker.className = "usage-guide-marker";
    marker.textContent = stage.marker;

    const canvasCol = document.createElement("div");
    canvasCol.className = "usage-guide-canvas-col";
    const canvas = document.createElement("canvas");
    canvas.className = "usage-guide-canvas";
    canvas.dataset.anim = stage.anim;
    canvasCol.appendChild(canvas);
    this.canvases.push(canvas);

    const text = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "usage-guide-stage-title";
    title.textContent = stage.title;
    const body = document.createElement("p");
    body.className = "usage-guide-stage-body";
    body.textContent = stage.body;
    text.append(title, body);

    el.append(marker, canvasCol, text);
    return el;
  }

  /** 序・結と同じ縦の時系列レール（.usage-guide-storyboard::before）に沿って
   *  マーカー「練」を置きつつ、右側の列全体を練習用サンドボックス
   *  （tutorialSandbox.ts）にあてる——挿絵1枚ぶんの96px幅では実際に操作できる
   *  キャンバスを収められないため、他のstageの3カラム(48px 96px 1fr)ではなく
   *  2カラム(48px 1fr)の専用レイアウトにする（style.cssの
   *  .usage-guide-stage--practice参照）。 */
  private buildPracticeStage(): HTMLElement {
    const el = document.createElement("div");
    el.className = "usage-guide-stage usage-guide-stage--practice";

    const marker = document.createElement("div");
    marker.className = "usage-guide-marker";
    marker.textContent = "練";

    const text = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "usage-guide-stage-title";
    title.textContent = "手を動かしてみましょう";
    const sandboxRoot = document.createElement("div");
    this.sandbox = new TutorialSandbox(sandboxRoot);
    text.append(title, sandboxRoot);

    el.append(marker, text);
    return el;
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.key === "Escape") this.close();
  };

  open(onClose?: () => void): void {
    if (this.opened) return;
    this.opened = true;
    this.onClose = onClose ?? null;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.setVisible(true);
    window.addEventListener("keydown", this.onKeyDown, true);
    requestAnimationFrame(() => this.sheet.focus());
    this.startAnimations();
    this.sandbox?.start();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    this.stopAnimations();
    this.sandbox?.stop();
    this.lastFocused?.focus();
    this.lastFocused = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  /** 挿絵は開いている間だけ動かす（閉じている間にrequestAnimationFrameを
   *  回し続けて無駄に電力を使わないため）。 */
  private startAnimations(): void {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const states = this.canvases.map((canvas) => ({ canvas, ctx: fitCanvas(canvas), start: 0 }));
    const loop = (ts: number) => {
      for (const s of states) {
        if (s.start === 0) s.start = ts;
        drawStageAnim(s.ctx, s.canvas.dataset.anim as Stage["anim"], ts - s.start, reduceMotion);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopAnimations(): void {
    cancelAnimationFrame(this.raf);
  }
}

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 96;
  const h = rect.height || 96;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const INK = "oklch(22% 0.012 55)";

/** 一筆書きの円相を、生成的な筆致（太さのむら・わずかな歪み）で描く
 *  （tutorial/tutorialCanvas.tsで使っていたのと同じ数式）。 */
function strokeEnso(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
  opacity: number,
  color: string,
  seed: number
): void {
  const segments = 48;
  const startRad = (startDeg * Math.PI) / 180;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a0 = startRad + sweepRad * t0;
    const a1 = startRad + sweepRad * t1;
    const mid = (t0 + t1) / 2;
    const pressure = Math.sin(Math.PI * Math.min(mid * 1.08, 1));
    const wobble = 1 + 0.06 * Math.sin((mid * 37 + seed) * 6.283);
    ctx.lineWidth = (1.4 + pressure * 4) * wobble;
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.sin(mid * 23 + seed) * 1.2, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStageAnim(ctx: CanvasRenderingContext2D, kind: Stage["anim"], t: number, reduceMotion: boolean): void {
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  const h = ctx.canvas.height / (window.devicePixelRatio || 1);
  if (w === 0 || h === 0) return;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.34;

  if (kind === "intro") {
    const p = reduceMotion ? 1 : Math.min(1, t / 2200);
    const eased = 1 - (1 - p) ** 3;
    strokeEnso(ctx, cx, cy, r, -100, 328 * eased, 1, INK, 1);
  } else if (kind === "close") {
    strokeEnso(ctx, cx, cy, r, -95, 342, 1, INK, 7);
  }
}
