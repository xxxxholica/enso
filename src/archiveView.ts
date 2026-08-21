import { fitCanvasToContainer } from "./canvasSizing";
import { opacityAtTime } from "./fade";
import { renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";

const CIRCLE_BORDER = "oklch(22% 0.012 55 / 0.08)";

/** シークバーで遡れる期間の上限。検索性を意図的に下げるための制約
 *  ——「消えたものを掘り返せる道具」にしたくない、という設計判断。 */
const MAX_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * シークバーの日時表示。あえて絶対時刻（何月何日の何時何分）は出さず、
 * 「1時間前」のような相対表現だけにしている——特定の瞬間をピンポイントで
 * 検索・照合できてしまうと、このアプリが目指す「なぞらなければ消えていく」
 * 手触りに反するため（ユーザー指示）。
 */
function formatRelativeTime(t: number, now: number): string {
  const diffMs = Math.max(0, now - t);
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}日前`;
}

/**
 * 振り返りビュー:
 *  - 通常のキャンバスと同じ大きさ・同じ仕組み（fitCanvasToContainer）で円を表示する。
 *    「雨雲レーダー」のようなシークバーをスライドすると、その瞬間の円の状態
 *    （生きているメモも消えたメモも含む）を再現する。
 *  - シークバー自体は、道具バーが表示されている場所（フッターの操作パネル上段）に
 *    置き換えて表示する。そのため見た目上の主役であるプレビュー用の円は
 *    canvasContainer（#archive-panel）に、シークバーは seekbarContainer
 *    （フッターの共有スロット）に、それぞれ別々にマウントする。
 *  - 消滅済みメモを個別に一覧・検索できる機能はあえて持たせない
 *    （「なぞらなければ消えていく」というコンセプトに反するため、ユーザー指示により削除）。
 *    振り返れるのはシークバーで辿れる円の状態だけであり、しかも日時は相対表現のみ・
 *    3日前までしか遡れないという制約がかかっている（検索性を意図的に下げるため）。
 */
export class ArchiveView {
  private canvasContainer: HTMLElement;
  private seekbarContainer: HTMLElement;
  private store: MemoStore;
  private dpr = Math.max(1, window.devicePixelRatio || 1);

  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  private canvasWrap!: HTMLElement;
  private radius = 0;
  private size = 0;

  private seekbarEl!: HTMLElement;
  private timestampEl!: HTMLElement;
  private slider!: HTMLInputElement;
  private emptyEl!: HTMLElement;

  constructor(canvasContainer: HTMLElement, seekbarContainer: HTMLElement, store: MemoStore) {
    this.canvasContainer = canvasContainer;
    this.seekbarContainer = seekbarContainer;
    this.store = store;
    this.buildCanvasDom();
    this.buildSeekbarDom();

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.canvasWrap);
    this.resize();
  }

  private buildCanvasDom(): void {
    const view = document.createElement("div");
    view.className = "archive-view";

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "archive-canvas-wrap";
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.className = "archive-preview";
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.previewCtx = ctx;
    this.canvasWrap.appendChild(this.previewCanvas);
    view.appendChild(this.canvasWrap);

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "archive-empty";
    this.emptyEl.textContent = "まだ何も書かれていません。";
    view.appendChild(this.emptyEl);

    this.canvasContainer.appendChild(view);
  }

  /** 道具バーと同じ場所（フッターの操作パネル上段）に置くシークバー。 */
  private buildSeekbarDom(): void {
    this.seekbarEl = document.createElement("div");
    this.seekbarEl.className = "seekbar";
    this.seekbarEl.hidden = true;

    this.timestampEl = document.createElement("div");
    this.timestampEl.className = "seekbar-timestamp";
    this.seekbarEl.appendChild(this.timestampEl);

    const track = document.createElement("div");
    track.className = "seekbar-track";

    const startLabel = document.createElement("span");
    startLabel.className = "seekbar-label";
    startLabel.textContent = "最初";
    track.appendChild(startLabel);

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "seekbar-slider";
    this.slider.step = "any";
    this.slider.addEventListener("input", () => {
      this.renderPreviewAt(Number(this.slider.value));
    });
    track.appendChild(this.slider);

    const nowLabel = document.createElement("span");
    nowLabel.className = "seekbar-label";
    nowLabel.textContent = "現在";
    track.appendChild(nowLabel);

    this.seekbarEl.appendChild(track);
    this.seekbarContainer.appendChild(this.seekbarEl);
  }

  /** 表示中かどうかにかかわらず呼んでよい。道具バーとシークバーの表示を切り替える。 */
  setActive(active: boolean): void {
    this.seekbarEl.hidden = !active;
    if (active) this.resize();
  }

  private resize(): void {
    const { radius, size } = fitCanvasToContainer(this.previewCanvas, this.canvasWrap, this.dpr);
    this.radius = radius;
    this.size = size;
    this.renderPreviewAt(Number(this.slider.value) || Date.now());
  }

  /** 表示を開いた（または切り替えた）瞬間に呼ぶ。シークバーの範囲を作り直す。 */
  render(): void {
    const now = Date.now();
    const all = this.store.getAll();

    if (all.length === 0) {
      this.emptyEl.hidden = false;
      this.seekbarEl.classList.add("seekbar-disabled");
      this.slider.disabled = true;
    } else {
      this.emptyEl.hidden = true;
      this.seekbarEl.classList.remove("seekbar-disabled");
      this.slider.disabled = false;
    }

    // 最も古いメモの作成時刻まで遡れるが、MAX_LOOKBACK_MS（3日）より前へは
    // 遡れないよう下限を切り上げる（検索性を意図的に下げるための制約）。
    const oldestCreatedAt = all.length > 0 ? Math.min(...all.map((m) => m.createdAt)) : now;
    const minCreatedAt = Math.max(oldestCreatedAt, now - MAX_LOOKBACK_MS);
    this.slider.min = String(minCreatedAt);
    this.slider.max = String(now);
    this.slider.value = String(now);
    this.renderPreviewAt(now);
  }

  private renderPreviewAt(t: number): void {
    this.timestampEl.textContent = formatRelativeTime(t, Date.now());

    const ctx = this.previewCtx;
    const radius = this.radius;
    const size = this.size;
    const cx = size / 2;
    const cy = size / 2;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = CIRCLE_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);

    drawRuledPaper(ctx, radius);

    for (const memo of this.store.getAll()) {
      const opacity = opacityAtTime(memo.traceHistory, memo.lifespanDays, t);
      if (opacity === null || opacity <= 0) continue;
      renderMemoAt(ctx, memo, radius, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.restore(); // clip
    ctx.restore(); // setTransform
  }
}
