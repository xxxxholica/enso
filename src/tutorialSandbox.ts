import { CircularCanvas } from "./canvasView";
import type { ToolState } from "./canvasView";
import { createFadeVisibility } from "./fadeVisibility";
import { FIXED_LIFESPAN_DAYS } from "./fade";
import { MemoStore } from "./memoStore";
import { RewindSelector } from "./rewindSelector";
import { FONT_SIZE_STEPS, measureTextBoxWidthPx, normalizedBoxSize, wrapTextAtReferenceScale } from "./textLayout";
import { PEN_WIDTH_RANGE } from "./toolStyle";
import type { Memo, Point } from "./types";

const INK = "oklch(22% 0.012 55)";
const HOUR = 60 * 60 * 1000;

/** 仮想時計の進み方（実時間1msに対して盤面上の時間が何ms進むか）。本物の
 *  寿命（1日、FIXED_LIFESPAN_DAYS）を数十秒〜数分で体験できるよう加速する。 */
const VIRTUAL_ACCEL = 400;

/** 道具はすべて選択（移動）道具に固定する——このサンドボックスで体験させたい
 *  操作は「掴んで回す」「振り返りスライダー」の2つだけで、道具バー自体を
 *  持たない（ユーザー指示：習得させる操作を2つの時間操作に絞る）。
 *  color/fontSize/eraserRadius等は"move"では参照されないため値そのものに意味はない。 */
const SANDBOX_TOOL_STATE: ToolState = {
  tool: "move",
  color: INK,
  lifespanDays: FIXED_LIFESPAN_DAYS,
  fontSize: 24,
  lineWidth: PEN_WIDTH_RANGE.default,
  eraserRadius: 16,
};

type StepId = "watch" | "keep" | "release" | "rewind" | "done";
const STEP_ORDER: StepId[] = ["watch", "keep", "release", "rewind", "done"];

const MESSAGES: Record<StepId, string> = {
  watch: "いくつか、思いつきを置いてみました。何もしなければ、自然に薄れて消えていきます。少し眺めてみましょう。",
  keep: "残したい一枚に触れたまま、指で円を描くように反時計回りに回してみてください。時間が巻き戻り、また留まります。",
  release: "今度は、要らない一枚に触れたまま、時計回りに回して早く手放してみましょう。",
  rewind: "下のスライダーを動かして、少し前の盤面を振り返ってみましょう。",
  done: "全部は残せません。だからこそ、そうやって選び続けた一枚には意味があります。",
};

/** 掴んで回す対象の追跡用。lastTracedAtは移動道具の振り回し操作
 *  （nudgeMemoClock、canvasView.ts）でしか変化しないため、seed時の値からの
 *  増減を見るだけで「反時計回りに回した／時計回りに回した」を正確に検出できる
 *  ——受動的な経時フェード（tick）はlastTracedAtを一切書き換えないので、
 *  放置による自然消滅と誤検知することもない。 */
interface TrackedMemo {
  id: string;
  initialLastTracedAt: number;
}

/**
 * 使い方ページ（usageGuide.ts）の中間パートで使う、体験専用のサンドボックス。
 * 本物のCircularCanvas/MemoStoreとは完全に別の使い捨てインスタンスを持ち、
 * 自前のrequestAnimationFrameで駆動する——本物のインスタンスは外から
 * render()を呼び続けないと何も描かれないため（過去のインタラクティブ
 * チュートリアルが撤廃された理由の1つ）。
 *
 * ポインタ操作（pointerdown/move/leave）はこのインスタンス自身のcanvas要素に
 * 閉じたリスナーのため、使い方ページの全画面オーバーレイが背後の本物の
 * キャンバスを覆っている間は本物には一切届かない。window単位のkeydownは
 * usageGuide.ts側がcapture段でstopPropagationして本物のonGlobalKeyDown
 * （ブラインドタイピング）に一切渡さない——このサンドボックス自身もテキスト
 * 入力を持たないため、キー入力を横取りされても機能に支障はない。window単位の
 * pointerup/pointercancelだけは意図的に横取りしていない：本物のonPointerUpは
 * 自身の状態がidleの間は何もしない（=このサンドボックスを操作している間、
 * 本物は必ずidleのまま）ため無害であり、かつこのサンドボックス自身の
 * ジェスチャー終了処理もwindow単位のpointerupに依存しているため、
 * window全体でstopPropagationするとこちらの操作まで巻き込んで壊れてしまう。
 */
export class TutorialSandbox {
  private canvasWrap: HTMLElement;
  private messageEl: HTMLElement;
  private rewindWrap: HTMLElement;
  private setRewindVisible: (show: boolean) => void;
  private nextBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;

  private store: MemoStore | null = null;
  private canvasView: CircularCanvas | null = null;
  private rewindSelector: RewindSelector | null = null;

  private raf = 0;
  private running = false;
  private realStartMs = 0;
  private virtualBaseMs = 0;
  private rewindTried = false;

  private step: StepId = "watch";
  private keepMemo: TrackedMemo | null = null;
  private releaseMemo: TrackedMemo | null = null;

  constructor(container: HTMLElement) {
    container.className = "tutorial-sandbox";

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "tutorial-sandbox-canvas-wrap";

    this.messageEl = document.createElement("p");
    this.messageEl.className = "tutorial-sandbox-message";

    this.rewindWrap = document.createElement("div");
    this.rewindWrap.className = "tutorial-sandbox-seek fade-visible";
    this.rewindWrap.hidden = true;
    this.setRewindVisible = createFadeVisibility(this.rewindWrap);

    const actions = document.createElement("div");
    actions.className = "tutorial-sandbox-actions";
    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.className = "pill-btn";
    this.nextBtn.textContent = "つぎへ";
    this.nextBtn.addEventListener("click", () => this.advanceTo("keep"));
    this.skipBtn = document.createElement("button");
    this.skipBtn.type = "button";
    this.skipBtn.className = "text-link tutorial-sandbox-skip";
    this.skipBtn.textContent = "この体験をスキップ";
    this.skipBtn.addEventListener("click", () => this.advanceTo("done"));
    actions.append(this.nextBtn, this.skipBtn);

    container.append(this.canvasWrap, this.messageEl, this.rewindWrap, actions);
  }

  /** 使い方ページを開いている間だけ呼ぶ。開き直すたびにまっさらな状態から
   *  やり直せるよう、新しいストア・キャンバスを作り直す。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = "watch";
    this.rewindTried = false;
    this.syncStep();

    this.store = new MemoStore(undefined, false);
    this.canvasView = new CircularCanvas(this.canvasWrap, this.store, () => SANDBOX_TOOL_STATE);
    this.realStartMs = Date.now();
    this.virtualBaseMs = Date.now();
    this.seed();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 使い方ページを閉じたら呼ぶ。CircularCanvasのwindow単位リスナー等を
   *  destroy()できちんと解除し、rAFも止める——開いたままrAFを回し続けると
   *  無駄に電力を使う（usageGuide.tsの挿絵アニメーションと同じ理由）。 */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvasView?.destroy();
    this.canvasView = null;
    this.store = null;
    this.keepMemo = null;
    this.releaseMemo = null;
    this.rewindSelector = null;
    this.rewindWrap.replaceChildren();
    this.rewindWrap.hidden = true;
    this.rewindWrap.classList.remove("is-visible");
  }

  private seed(): void {
    if (!this.store) return;
    const now0 = this.virtualBaseMs;
    // テキスト測定専用の使い捨てcanvas（DOMには挿入しない）。手描きストローク
    // だと、掴んで動かした先が円の縁にかかった時に点ごとクランプされて線が
    // 潰れて見えてしまう（ユーザー指摘）ため、位置だけがまとめてクランプされる
    // テキストメモに変えた。
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    // 放っておくと消えていく様子を最初から見せるための、既に薄れかけた1枚
    // （じきに完全に消える）。手を出さなくても物語が進むよう、どの手順にも
    // 紐付けない添え物として置く。
    seedTextThought(measureCtx, this.store, { x: 0, y: 0.45 }, "夢の続き", 11 * HOUR, now0);
    // 掴んで振り回すと、その分だけメモ自体もポインタに追従して動く
    // （canvasView.tsのupdateRotationGesture参照）。縁ぎりぎりに置くと、
    // 少し振り回しただけで縁の外にはみ出して欠けて見えてしまうため、
    // 中心寄りに置いて振り回す余地を持たせる。
    this.keepMemo = trackedMemoOf(
      seedTextThought(measureCtx, this.store, { x: -0.32, y: -0.22 }, "行きたい場所", 5 * HOUR, now0)
    );
    this.releaseMemo = trackedMemoOf(
      seedTextThought(measureCtx, this.store, { x: 0.32, y: -0.22 }, "買い物リスト", 0.5 * HOUR, now0)
    );
  }

  private currentVirtualNow(): number {
    return this.virtualBaseMs + (Date.now() - this.realStartMs) * VIRTUAL_ACCEL;
  }

  private loop = (): void => {
    if (!this.running || !this.store || !this.canvasView) return;
    const now = this.currentVirtualNow();
    this.store.tick(now);
    this.canvasView.render(now);
    this.checkProgress();
    this.raf = requestAnimationFrame(this.loop);
  };

  private checkProgress(): void {
    if (!this.store) return;
    const memos: readonly Memo[] = this.store.getAll();
    if (this.step === "keep" && this.keepMemo) {
      const memo = memos.find((m) => m.id === this.keepMemo!.id);
      if (memo && memo.lastTracedAt > this.keepMemo.initialLastTracedAt) this.advanceTo("release");
    } else if (this.step === "release" && this.releaseMemo) {
      const memo = memos.find((m) => m.id === this.releaseMemo!.id);
      if (memo && memo.lastTracedAt < this.releaseMemo.initialLastTracedAt) this.advanceTo("rewind");
    } else if (this.step === "rewind" && this.rewindTried) {
      this.advanceTo("done");
    }
  }

  /** 手順を先に進める（後戻りはしない）。 */
  private advanceTo(step: StepId): void {
    if (STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(this.step)) return;
    this.step = step;
    if (step === "rewind") this.mountRewind();
    this.syncStep();
  }

  private syncStep(): void {
    this.messageEl.textContent = MESSAGES[this.step];
    this.nextBtn.hidden = this.step !== "watch";
    this.skipBtn.hidden = this.step === "done";
  }

  /** 振り返りスライダーは「遡る」手順に入って初めて出す（一度に全部の道具を
   *  見せず、順番に体験させるため）。本物のRewindSelectorをそのまま使うが、
   *  値の受け渡し（getRewindAt）はDate.now()基準のため、加速した仮想時計を
   *  使うここでは生のms（getRewindMs）を自分で仮想「今」から引いて渡す。 */
  private mountRewind(): void {
    if (this.rewindSelector) return;
    this.rewindWrap.hidden = false;
    this.rewindSelector = new RewindSelector(this.rewindWrap, () => {
      if (!this.rewindSelector || !this.canvasView) return;
      const ms = this.rewindSelector.getRewindMs();
      this.canvasView.setRewindAt(ms <= 0 ? null : this.currentVirtualNow() - ms);
      if (ms > 0) this.rewindTried = true;
    });
    this.setRewindVisible(true);
  }
}

/** 短い「思いつき」のテキストメモを、指定した仮想時刻に作られたことにして
 *  仕込む。backdateMsぶん過去に作ったことにすることで、開いた瞬間から
 *  薄れかけの盤面を見せられる。 */
function seedTextThought(
  measureCtx: CanvasRenderingContext2D,
  store: MemoStore,
  center: Point,
  text: string,
  backdateMs: number,
  now0: number
): Memo {
  const fontSize = FONT_SIZE_STEPS.medium;
  const boxWidthPx = measureTextBoxWidthPx(measureCtx, text, fontSize);
  const textLines = wrapTextAtReferenceScale(measureCtx, text, fontSize, boxWidthPx);
  const { width, height } = normalizedBoxSize(fontSize, textLines.length, boxWidthPx);
  return store.createTextMemo(
    center,
    text,
    textLines,
    fontSize,
    width,
    height,
    { color: INK, lifespanDays: FIXED_LIFESPAN_DAYS },
    now0 - backdateMs
  );
}

function trackedMemoOf(memo: Memo): TrackedMemo {
  return { id: memo.id, initialLastTracedAt: memo.lastTracedAt };
}
