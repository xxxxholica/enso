import { createFadeVisibility } from "./fadeVisibility";

/**
 * 使い方ページ：円相の由来と基本操作を、序・一・二・三・四・結の一続きの
 * 読み物として見せる全画面の静的ページ。
 *
 * 以前は本物のキャンバスを使って実際に書く・消える・生き返らせるを体験させる
 * インタラクティブなチュートリアルだったが、本物のキャンバスと道具バーを
 * 共存させたことで、①本物のCircularCanvasは外からrequestAnimationFrameで
 * render()を呼び続けないと何も描かれない、②裏に隠れているだけの本物の
 * キャンバスがwindow単位のブラインドタイピングを拾って実データに書き込んで
 * しまう、といった不具合が繰り返し起き、実装・保守のコストがリターンに
 * 見合わなくなったため撤廃した。代わりに、操作を要求しない読み物に切り替える
 * ——挿絵のcanvasアニメーションはループ再生されるだけの飾りで、ポインタも
 * キーボードも一切受け付けない（本物のstore・道具バーには一切触れない）。
 *
 * 全画面モーダルの骨格・フォーカスの作法はtemplatePicker.tsに揃える。
 * Escapeキーを含む全キー入力をcapture段でstopPropagationするのも
 * templatePicker.tsと同じ理由——このページ自身はテキスト入力を一切持たない
 * ため安全に全キーを止められ、かつそうしないと背後の本物のキャンバスの
 * ブラインドタイピングにキー入力が漏れてしまう（canvasView.onGlobalKeyDown）。
 */

interface Stage {
  marker: string;
  title: string;
  body: string;
  note?: string;
  anim: "intro" | "write" | "fade" | "revive" | "release" | "close";
}

const STAGES: Stage[] = [
  {
    marker: "序",
    title: "円相（えんそう）",
    anim: "intro",
    body: "一筆で描く円相。禅の書画で、悟りやその瞬間の完全性を表すとされます。この一枚も、同じように一筆で生まれ、同じように消えていきます。",
  },
  {
    marker: "一",
    title: "思いつきを、そのまま",
    anim: "write",
    body: "気になったことを、そのまま書きなぐるだけ。フォルダも、タグも、保存ボタンもありません。書ける場所は、円の内側だけです。",
  },
  {
    marker: "二",
    title: "完成を、目指さない",
    anim: "fade",
    body: "円相は、完成を目指しません。消えていくことも、この一枚のうちです。書いたものは、自然に薄れて消えていきます。",
    note: "※実際には約1日をかけて、ゆっくり薄れていきます。",
  },
  {
    marker: "三",
    title: "もう一度、円を描く",
    anim: "revive",
    body: "本当に手放したくない一枚だけ、「選択」で掴んで、指で円を描くように動かしてください。反時計回りになぞれば、また今日に留まります。",
    note: "※時計回りに回すと、逆に早く薄れていきます。",
  },
  {
    marker: "四",
    title: "残った一枚",
    anim: "release",
    body: "全部は残せません。だからこそ、そうやって選び続けた一枚には意味があります。",
  },
  {
    marker: "結",
    title: "円相",
    anim: "close",
    body: "一筆の円は、悟りでも完成でもなく、その瞬間だけの完全さ。今、本当に大事なものだけが、ここに残ります。",
  },
];

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
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "usage-guide-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());
    this.sheet.appendChild(closeBtn);

    const head = document.createElement("header");
    head.className = "usage-guide-head";
    const title = document.createElement("h2");
    title.id = "usage-guide-title";
    title.className = "usage-guide-title";
    title.textContent = "円相";
    const lede = document.createElement("p");
    lede.className = "usage-guide-lede";
    lede.textContent =
      "書いたものが、ゆっくり消えていく円のキャンバスです。消えることは不具合ではなく、このアプリの考え方そのものです。";
    head.append(title, lede);
    this.sheet.appendChild(head);

    const storyboard = document.createElement("div");
    storyboard.className = "usage-guide-storyboard";
    for (const stage of STAGES) storyboard.appendChild(this.buildStage(stage));
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
    if (stage.note) {
      const note = document.createElement("span");
      note.className = "usage-guide-stage-note";
      note.textContent = stage.note;
      text.appendChild(note);
    }

    el.append(marker, canvasCol, text);
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
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.setVisible(false);
    this.stopAnimations();
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
const ACCENT = "oklch(52% 0.2 25)";

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

/** 手描きの走り書き一本を模した、短い曲線。 */
function memoDash(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, angle: number, opacity: number, color: string): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = 2.4;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(0, -w * 0.4, w / 2, w * 0.1);
  ctx.stroke();
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
  } else if (kind === "write") {
    strokeEnso(ctx, cx, cy, r, -100, 320, 1, INK, 2);
    memoDash(ctx, cx - r * 0.32, cy - r * 0.1, r * 0.5, -0.15, 1, INK);
    memoDash(ctx, cx + r * 0.15, cy + r * 0.35, r * 0.4, 0.3, 1, INK);
  } else if (kind === "fade") {
    strokeEnso(ctx, cx, cy, r, -100, 320, 1, INK, 3);
    const breathe = reduceMotion ? 0.28 : 0.28 + 0.16 * (0.5 + 0.5 * Math.sin(t / 900));
    memoDash(ctx, cx - r * 0.32, cy - r * 0.1, r * 0.5, -0.15, breathe, INK);
    memoDash(ctx, cx + r * 0.15, cy + r * 0.35, r * 0.4, 0.3, breathe * 0.7, INK);
  } else if (kind === "revive") {
    strokeEnso(ctx, cx, cy, r, -100, 320, 0.9, INK, 4);
    const ax = cx - r * 0.32;
    const ay = cy - r * 0.1;
    memoDash(ctx, ax, ay, r * 0.5, -0.15, 1, INK);
    const ang = reduceMotion ? 0 : t / 700;
    strokeEnso(ctx, ax, ay, r * 0.34, (ang * 180) / Math.PI, 210, 0.9, ACCENT, 5);
  } else if (kind === "release") {
    strokeEnso(ctx, cx, cy, r, -100, 300, 1, INK, 6);
    const drift = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t / 1400);
    memoDash(ctx, cx + r * (0.1 + drift * 0.55), cy - r * (0.5 + drift * 0.35), r * 0.34, -0.5, Math.max(0.15, 1 - drift * 0.6), INK);
  } else if (kind === "close") {
    strokeEnso(ctx, cx, cy, r, -95, 342, 1, INK, 7);
  }
}
