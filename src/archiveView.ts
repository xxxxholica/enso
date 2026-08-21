import { fitCanvasToContainer } from "./canvasSizing";
import { createFadeVisibility } from "./fadeVisibility";
import { opacityAtTime } from "./fade";
import { renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import { DURATION_STEPS } from "./durationSteps";

const CIRCLE_BORDER = "oklch(22% 0.012 55 / 0.08)";

interface SeekStep {
  label: string;
  ms: number;
}

/**
 * 振り返りシークバーの目盛り。DURATION_STEPSの末尾（7日）を除いた8段階
 * （15分〜3日）を「何分/時間/日前か」という向き——遠い過去（左）から現在（右）へ
 * ——に並べ替え、右端に「たった今」（=現在、ms=0）を足した9個の目盛り。
 * 「消えるまでの期間」側は上限なく7日まで使うが、振り返り側だけこの制約を
 * かけているのは、検索性を意図的に下げるための設計判断（下のMAX_LOOKBACK_MS参照）
 * を、目盛りの範囲としてもそのまま反映しているため。
 */
const ARCHIVE_STEPS: SeekStep[] = [
  ...DURATION_STEPS.slice(0, -1)
    .slice()
    .reverse()
    .map((step) => ({ label: `${step.label}前`, ms: step.ms })),
  { label: "たった今", ms: 0 },
];

/** シークバーで遡れる期間の上限（=ARCHIVE_STEPSの最も遠い目盛り、3日）。
 *  検索性を意図的に下げるための制約——「消えたものを掘り返せる道具」に
 *  したくない、という設計判断。あえて絶対時刻は出さず、「1時間前」のような
 *  相対表現（＝目盛りのラベルそのもの）だけにしているのも同じ理由から。 */
const MAX_LOOKBACK_MS = ARCHIVE_STEPS[0].ms;

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
  private scale = 0;
  private width = 0;
  private height = 0;

  private seekbarEl!: HTMLElement;
  private seekbarFade!: (show: boolean) => void;
  private timestampEl!: HTMLElement;
  private slider!: HTMLInputElement;
  /** ARCHIVE_STEPSへのインデックス（大きいほど現在に近い）。9=たった今が既定。 */
  private currentIndex = ARCHIVE_STEPS.length - 1;

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

    this.canvasContainer.appendChild(view);
  }

  /** 道具バーと同じ場所（フッターの操作パネル上段）に置くシークバー。 */
  private buildSeekbarDom(): void {
    this.seekbarEl = document.createElement("div");
    // control-block: 道具バー側の3ブロック（ツール選択／詳細／時間選択）と同じ
    // 枠線付きの区画にして、外側の.control-panelがカードとしての見た目を
    // 持たなくなった後も、単体でひとまとまりの操作ブロックだと分かるようにする。
    // bottom-bar-fade: 画面切り替え時にふわっとクロスフェードするためのクラス
    // （toolbar.tsのbottom-bar-fadeと同じ仕組み。ユーザー指示）。
    this.seekbarEl.className = "seekbar control-block bottom-bar-fade";
    this.seekbarEl.hidden = true;
    this.seekbarFade = createFadeVisibility(this.seekbarEl);

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
    this.slider.step = "1";
    this.slider.addEventListener("input", () => {
      this.currentIndex = Number(this.slider.value);
      this.updatePreviewForCurrentIndex();
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
    this.seekbarFade(active);
    if (active) this.resize();
  }

  private resize(): void {
    const { scale, width, height } = fitCanvasToContainer(this.previewCanvas, this.canvasWrap, this.dpr);
    this.scale = scale;
    this.width = width;
    this.height = height;
    this.updatePreviewForCurrentIndex();
  }

  /** 表示を開いた（または切り替えた）瞬間に呼ぶ。遡れる範囲（スライダーの下限）を作り直す。 */
  render(): void {
    const now = Date.now();
    const all = this.store.getAll();

    if (all.length === 0) {
      this.seekbarEl.classList.add("seekbar-disabled");
      this.slider.disabled = true;
    } else {
      this.seekbarEl.classList.remove("seekbar-disabled");
      this.slider.disabled = false;
    }

    // 最も古いメモの作成時刻まで遡れるが、MAX_LOOKBACK_MS（3日）より前の目盛りは
    // 選べないよう下限インデックスを切り上げる（検索性を意図的に下げるための制約）。
    // ARCHIVE_STEPSは遠い過去(ms大)→現在(ms=0)の順なので、遡れる範囲に収まる
    // 最初の（＝一番遠い）目盛りを探す。末尾は必ずms=0で条件を満たすので必ず見つかる。
    const oldestCreatedAt = all.length > 0 ? Math.min(...all.map((m) => m.createdAt)) : now;
    // MAX_LOOKBACK_MS（=ARCHIVE_STEPSの最遠点）より前は、そもそも目盛りが
    // 存在しないので自動的に選べないが、意図を明示するため上限もここで揃えて掛けておく。
    const lookbackAvailable = Math.min(now - oldestCreatedAt, MAX_LOOKBACK_MS);
    const minValidIndex = Math.max(
      0,
      ARCHIVE_STEPS.findIndex((step) => step.ms <= lookbackAvailable)
    );
    this.slider.min = String(minValidIndex);
    this.slider.max = String(ARCHIVE_STEPS.length - 1);
    this.currentIndex = ARCHIVE_STEPS.length - 1;
    this.slider.value = String(this.currentIndex);
    this.updatePreviewForCurrentIndex();
  }

  private updatePreviewForCurrentIndex(): void {
    const step = ARCHIVE_STEPS[this.currentIndex];
    this.timestampEl.textContent = step.label;
    this.renderPreviewAt(Date.now() - step.ms);
  }

  private renderPreviewAt(t: number): void {
    const ctx = this.previewCtx;
    const scale = this.scale;
    const width = this.width;
    const height = this.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(cx, cy);

    ctx.beginPath();
    ctx.arc(0, 0, scale, 0, Math.PI * 2);
    ctx.strokeStyle = CIRCLE_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, scale, 0, Math.PI * 2);
    ctx.clip();

    drawRuledPaper(ctx, scale);

    for (const memo of this.store.getAll()) {
      const opacity = opacityAtTime(memo.traceHistory, memo.lifespanDays, t);
      if (opacity === null || opacity <= 0) continue;
      renderMemoAt(ctx, memo, scale, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.restore(); // clip
    ctx.restore(); // translate + setTransform
  }
}
