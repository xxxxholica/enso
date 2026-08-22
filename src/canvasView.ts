import { fitCanvasToContainer } from "./canvasSizing";
import { DEFAULT_FRAME_SHAPE_ID, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { circleIntersectsBox, pointNearStrokes } from "./geometry";
import { renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import { getTemplateText } from "./templates";
import type { TemplateId } from "./templates";
import {
  fontPxForRender,
  normalizedBoxSize,
  REFERENCE_TEXT_BOX_WIDTH_PX,
  TEXT_FONT_FAMILY,
  wrapTextAtReferenceScale,
} from "./textLayout";
import { REFERENCE_RADIUS } from "./toolStyle";
import type { ToolbarTool } from "./toolbar";
import type { LifespanDays, Memo, Point, TextMemo } from "./types";

const CIRCLE_BORDER = "oklch(22% 0.012 55 / 0.08)";
const CENTER_DOT = "oklch(22% 0.012 55 / 0.18)";
const HINT_TEXT = "oklch(22% 0.012 55 / 0.4)";
const TRACE_GLOW = "oklch(22% 0.012 55 / 0.14)";
const ERASER_CURSOR = "oklch(22% 0.012 55 / 0.3)";
/** テンプレートの配置ガイド（指を離すまでの位置プレビュー）の不透明度。 */
const TEMPLATE_GUIDE_ALPHA = 0.4;

/** 画面ピクセルでの当たり判定の許容範囲。円のサイズが変わっても指先の精度感が一定になるよう、
 *  実際に使うときは現在の半径で正規化してから比較する（normalizedThreshold = PX / radius）。 */
const HIT_THRESHOLD_PX = 12;
const ERASER_RADIUS_PX = 16;
/** 書き終えてから何 ms 操作がなければ「同じメモへの継続」を打ち切るか */
const WRITING_SESSION_IDLE_MS = 1400;

export interface ToolState {
  tool: ToolbarTool;
  color: string;
  lifespanDays: LifespanDays;
  /** 基準円(半径340px)におけるフォントサイズ(px)。テキストツールの時のみ使う。 */
  fontSize: number;
  /** 基準円(半径340px)におけるペンの線の太さ(px)。ペン道具の時のみ使う。 */
  lineWidth: number;
}

interface DrawState {
  mode: "idle" | "drawing" | "tracing" | "erasing" | "moving";
  activeMemoId: string | null;
  tracingMemoId: string | null;
  /** 移動道具でドラッグ中のメモID。ドラッグ中はポインタが動くたびに差分移動を積む。 */
  movingMemoId: string | null;
  idleTimer: number | null;
  lastPoint: Point | null;
}

/**
 * メモの座標は「円の半径を1とする正規化座標」で保存する（中心が原点、
 * 円周上が距離1）。こうしておくとウィンドウサイズが変わって円の物理的な
 * 大きさ（px）が変化しても、既存のメモが縮んで見えたり位置がずれたりしない
 * ——ウィンドウを広げれば単純にその分だけ拡大して描かれる。
 */
export interface CircularCanvasOptions {
  /** キャンバスの一辺に対する内容円の半径の割合。省略した場合はfitCanvasToContainer
   *  の既定値（固定0.43）を使う。キャンバスの大きさ・フレーム形状・縁取りの太さから
   *  毎回もっとも大きく安全に収まる値を動的に計算したい呼び出し元（SMUIのレンズ）は、
   *  sizeを受け取る関数を渡す（canvasSizing.computeAutoScale参照）。 */
  contentScaleFactor?: number | ((size: number) => number);
  frameShapeId?: FrameShapeId;
  /** 外枠線の色・太さ。既定は通常キャンバスの薄い1px線のまま
   *  （SMUIの太いウェリントン風フレームだけがこれを上書きする）。 */
  frameStrokeColor?: string;
  frameStrokeWidth?: number;
  /** falseの場合、ポインタ操作を一切受け付けない。SMUIの右レンズが共有キャンバスに
   *  まだ接続されていない間、白い罫線の紙だけを表示するプレースホルダー表現に使う
   *  （ユーザー指示）。既定true。 */
  interactive?: boolean;
}

export class CircularCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 0;
  private centerPx: Point = { x: 0, y: 0 };
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private resizeObserver: ResizeObserver;
  private contentScaleFactor: number | ((size: number) => number) | undefined;
  private frameShapeId: FrameShapeId;
  private frameStrokeColor: string;
  private frameStrokeWidth: number;
  private interactive: boolean;
  /** クリップ・外枠描画に使うPath2D。scale/frameShapeId/frameStrokeWidthが変わる
   *  resize()/setFrameShape()のタイミングでだけ組み立て直し、render()（毎フレーム）
   *  では使い回す——Path2Dの構築自体は軽くないため。 */
  private framePath: Path2D = new Path2D();
  private strokePath: Path2D = new Path2D();
  private state: DrawState = {
    mode: "idle",
    activeMemoId: null,
    tracingMemoId: null,
    movingMemoId: null,
    idleTimer: null,
    lastPoint: null,
  };

  public getToolState: () => ToolState;
  private container: HTMLElement;
  private store: MemoStore;
  private textEditor: HTMLTextAreaElement | null = null;
  /** 配置待ちのテンプレート文面。設定中は次のタップでその場所に置く（自由配置）。 */
  private pendingTemplate: string | null = null;
  /** 配置待ちの間、ポインタが今どこにあるか（正規化座標）。置かれる場所のガイド表示に使う。 */
  private templateHoverPoint: Point | null = null;

  constructor(
    container: HTMLElement,
    store: MemoStore,
    getToolState: () => ToolState,
    options: CircularCanvasOptions = {}
  ) {
    this.container = container;
    this.store = store;
    this.getToolState = getToolState;
    this.frameShapeId = options.frameShapeId ?? DEFAULT_FRAME_SHAPE_ID;
    this.frameStrokeColor = options.frameStrokeColor ?? CIRCLE_BORDER;
    this.frameStrokeWidth = options.frameStrokeWidth ?? 1;
    this.interactive = options.interactive ?? true;
    this.contentScaleFactor = options.contentScaleFactor;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "circle-canvas";
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.ctx = ctx;

    this.resize();
    // ウィンドウのリサイズだけでなく、フッターの折り返しやフォント読み込みによる
    // レイアウト変化など、コンテナの実サイズが変わるあらゆるタイミングを動的に捉える
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    if (this.interactive) {
      this.canvas.style.touchAction = "none";
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
    }
  }

  /** 利用可能な幅・高さのうち小さい方いっぱいまで円を広げ、上下限だけ設ける。 */
  private resize(): void {
    const { scale, centerPx } = fitCanvasToContainer(
      this.canvas,
      this.container,
      this.dpr,
      this.contentScaleFactor
    );
    this.scale = scale;
    this.centerPx = centerPx;
    this.rebuildFramePaths();
  }

  /** クリップ境界と外枠線のPath2Dを、今のscale/フレーム形状/縁の太さから組み立て直す。
   *  resize()（コンテナサイズ変化時）とsetFrameShape()（resize()経由）でだけ呼ばれる。 */
  private rebuildFramePaths(): void {
    const shape = getFrameShape(this.frameShapeId);
    this.framePath = shape.buildPath(this.scale);
    this.strokePath = shape.buildPath(this.scale + this.frameStrokeWidth / 2);
  }

  /** フレーム形状（丸眼鏡/楕円/長方形）を切り替える。次のrender()から反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeId = id;
    // 動的計算時のscale自体はMAX_SHAPE_REACH基準で形状に関わらず一定だが、
    // クリップ境界・紙の塗り範囲（drawRuledPaperのfillHalfExtent）は形状ごとに
    // 異なるため、次のrender()で正しく反映されるようここでresize()して
    // centerPx等を確定させておく。
    this.resize();
  }

  /** 画面ピクセル座標 → 正規化座標（円の半径・長方形の半辺を1とする、中心が原点）。
   *  今選んでいるフレーム形状の輪郭の外にあれば内側に丸め込む。 */
  private toNormalized(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.centerPx.x) / this.scale;
    const y = (clientY - rect.top - this.centerPx.y) / this.scale;
    return getFrameShape(this.frameShapeId).clamp({ x, y });
  }

  private scheduleSessionClose(): void {
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
    this.state.idleTimer = window.setTimeout(() => {
      this.state.activeMemoId = null;
      this.state.idleTimer = null;
    }, WRITING_SESSION_IDLE_MS);
  }

  /**
   * 書き込み中のセッションを強制的に閉じる。道具・色・消えるまでの期間を切り替えた直後に
   * 呼ぶことで、次のストロークが古いメモへの追記ではなく新しいメモとして始まるようにする。
   */
  closeWritingSession(): void {
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
    this.state.activeMemoId = null;
    this.state.idleTimer = null;
    this.pendingTemplate = null;
    this.templateHoverPoint = null;
  }

  private hitTestMemo(p: Point): Memo | null {
    const threshold = HIT_THRESHOLD_PX / this.scale;
    for (const memo of this.store.getActive()) {
      if (memo.kind === "stroke") {
        if (pointNearStrokes(p, memo.strokes, threshold)) return memo;
      } else if (
        circleIntersectsBox(p, threshold, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        })
      ) {
        return memo;
      }
    }
    return null;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    if (this.textEditor) return; // テキスト入力中は他の操作を受け付けない（blurで確定してから）
    const p = this.toNormalized(ev.clientX, ev.clientY);

    if (this.pendingTemplate) {
      // テンプレート配置待ち: タップした場所にそのまま置く（今選んでいる道具は問わない）
      this.placeTemplateAt(p, this.pendingTemplate);
      this.pendingTemplate = null;
      this.templateHoverPoint = null;
      return;
    }

    const tool = this.getToolState().tool;

    if (tool === "eraser") {
      this.state.mode = "erasing";
      this.state.lastPoint = p;
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.scale);
      return;
    }

    const hitMemo = this.hitTestMemo(p);

    if (tool === "move") {
      // 移動道具：既存のメモに触れた場合だけドラッグを開始する。何もない場所をタップしても
      // 新規作成はしない（道具の役割を「動かすだけ」に絞るため）
      if (hitMemo) {
        this.state.mode = "moving";
        this.state.movingMemoId = hitMemo.id;
        this.state.lastPoint = p;
      }
      return;
    }

    if (hitMemo) {
      // テキスト道具で既存のテキストメモに触れた場合は、なぞって復活ではなく編集を開く
      if (tool === "text" && hitMemo.kind === "text") {
        this.openTextEditor({ x: hitMemo.x, y: hitMemo.y }, hitMemo);
        return;
      }
      this.state.mode = "tracing";
      this.state.tracingMemoId = hitMemo.id;
      this.state.lastPoint = p;
      this.store.reviveMemo(hitMemo.id);
      return;
    }

    if (tool === "text") {
      this.openTextEditor(p);
      return;
    }

    this.state.mode = "drawing";
    if (this.state.activeMemoId) {
      this.store.startStroke(this.state.activeMemoId, p);
    } else {
      const { color, lifespanDays, lineWidth } = this.getToolState();
      const memo = this.store.createMemo(p, { tool: tool as "pen" | "marker", color, lifespanDays, lineWidth });
      this.state.activeMemoId = memo.id;
    }
    if (this.state.idleTimer !== null) window.clearTimeout(this.state.idleTimer);
  };

  /**
   * タップした位置にテキスト入力用の<textarea>を重ねて表示する。円のクリップの外に
   * 出しても構わないよう画面固定(position:fixed)で配置し、blurした時点で内容を
   * 確定する（Enterでは確定しない — IMEでの日本語変換の確定Enterと衝突しないように）。
   * editingMemoを渡すと既存のテキストメモの編集になる：元の位置・見た目（フォントサイズ・色）を
   * そのまま使い、内容だけ書き換えて更新する。空にして確定した場合はメモごと削除する。
   * Escapeで閉じた場合はキャンセル（新規なら何も作らず、編集なら元の内容のまま変更を破棄する）。
   */
  private openTextEditor(anchor: Point, editingMemo: TextMemo | null = null): void {
    if (this.textEditor) return;
    const { color: toolColor, fontSize: toolFontSize } = this.getToolState();
    const color = editingMemo?.color ?? toolColor;
    const fontSize = editingMemo?.fontSize ?? toolFontSize;
    const align = editingMemo?.align ?? "center";
    const canvasRect = this.canvas.getBoundingClientRect();
    const fontPx = fontPxForRender(fontSize, this.scale);
    const boxWidthPx = (REFERENCE_TEXT_BOX_WIDTH_PX / REFERENCE_RADIUS) * this.scale;
    const screenX = canvasRect.left + this.centerPx.x + anchor.x * this.scale;
    const screenY = canvasRect.top + this.centerPx.y + anchor.y * this.scale;

    const el = document.createElement("textarea");
    el.className = "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = editingMemo?.text ?? "";
    el.style.color = color;
    el.style.fontFamily = TEXT_FONT_FAMILY;
    el.style.fontSize = `${fontPx}px`;
    el.style.lineHeight = "1.4";
    el.style.textAlign = align;
    el.style.width = `${boxWidthPx}px`;
    // 完成後の描画（memo.x/yを中心に上下左右センタリング）と見た目が一致するよう、
    // 編集中も同じくアンカー点を中心に配置し、行が増えるたびに縦位置も再センタリングする。
    el.style.left = `${screenX - boxWidthPx / 2}px`;
    document.body.appendChild(el);
    this.textEditor = el;

    const recenterVertically = () => {
      el.style.height = "auto";
      const h = el.scrollHeight;
      el.style.height = `${h}px`;
      el.style.top = `${screenY - h / 2}px`;
    };
    recenterVertically();
    el.addEventListener("input", recenterVertically);
    // フォーカスがずれるとblurが即座に発火し得るため、appendの次のフレームでfocusする
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // 編集時はカーソルを末尾に
    });

    let cancelled = false;
    const commit = () => {
      if (this.textEditor !== el) return; // すでに片付け済みなら何もしない
      this.textEditor = null;
      const value = el.value.trim();
      el.remove();
      if (cancelled) return; // Escapeでの取り消し：新規作成なら何もせず、編集なら元の内容のまま

      if (editingMemo) {
        if (!value) {
          this.store.deleteMemo(editingMemo.id);
          return;
        }
        const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize);
        const { width, height } = normalizedBoxSize(fontSize, lines.length);
        this.store.updateTextMemo(editingMemo.id, value, lines, width, height);
        return;
      }

      if (!value) return;
      const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize);
      const { width, height } = normalizedBoxSize(fontSize, lines.length);
      this.store.createTextMemo(anchor, value, lines, fontSize, width, height, { color, lifespanDays: this.getToolState().lifespanDays });
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (kev) => {
      // 日本語IMEで変換候補を選んでいる最中のEscapeは「変換候補を閉じる」ためのキー入力であり、
      // 入力全体の取り消しではない。isComposingを見ずに反応すると、変換候補を1つ閉じたいだけ
      // なのに入力していた文字ごと消えてしまうバグになるため、IME変換中は無視する。
      if (kev.key === "Escape" && !kev.isComposing) {
        cancelled = true;
        el.blur();
      }
    });
  }

  /** 編集中のテキストがあれば確定する（画面切り替え・道具切り替え時に呼ぶ）。 */
  finishTextEditingIfOpen(): void {
    this.textEditor?.blur();
  }

  /**
   * 指定したテンプレート（持ち物チェック／電話メモ）を配置待ちにする。実際に置かれるのは
   * 次に盤面をタップした場所（自由配置——ユーザー指示）で、それまでは道具バーの操作は
   * 通常どおり効く。配置待ちの間はポインタを追いかけて配置ガイドを表示する
   * （renderTemplateGuideで描く）。
   */
  beginPlacingTemplate(id: TemplateId): void {
    this.pendingTemplate = getTemplateText(id);
  }

  /** 配置待ちのテンプレート文面を、タップされた場所（形の外なら内側に丸め込んだ位置）に
   *  テキストメモとして置く。項目は空欄のまま——書き込むのは通常のテキストメモの編集と同じ操作でよい。
   *  項目は行ごとに長さが変わるため、中央揃えだと左端がガタつく。左揃えにする（ユーザー指示）。 */
  private placeTemplateAt(anchor: Point, text: string): void {
    const { color, lifespanDays, fontSize } = this.getToolState();
    const lines = wrapTextAtReferenceScale(this.ctx, text, fontSize);
    const { width, height } = normalizedBoxSize(fontSize, lines.length);
    this.store.createTextMemo(anchor, text, lines, fontSize, width, height, {
      color,
      lifespanDays,
      align: "left",
    });
  }

  /** 配置待ちの間、ポインタの位置に「ここに置かれる」ことを示す薄いプレビューを描く。
   *  実際に置かれた後と同じ見た目（renderMemoAt）を使うので、位置・折り返し・揃えが
   *  そのまま本番の見た目のガイドになる。 */
  private renderTemplateGuide(ctx: CanvasRenderingContext2D, radius: number): void {
    if (!this.pendingTemplate || !this.templateHoverPoint) return;
    const { color, fontSize } = this.getToolState();
    const lines = wrapTextAtReferenceScale(this.ctx, this.pendingTemplate, fontSize);
    const { width, height } = normalizedBoxSize(fontSize, lines.length);
    const preview: TextMemo = {
      id: "template-guide",
      kind: "text",
      x: this.templateHoverPoint.x,
      y: this.templateHoverPoint.y,
      text: this.pendingTemplate,
      textLines: lines,
      fontSize,
      boxWidth: width,
      boxHeight: height,
      align: "left",
      createdAt: 0,
      lastTracedAt: 0,
      traceHistory: [0],
      lifespanDays: null,
      status: "active",
      color,
    };
    renderMemoAt(ctx, preview, radius, TEMPLATE_GUIDE_ALPHA);
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.pendingTemplate) {
      // 配置待ちの間はポインタを追いかけてガイドを表示するだけ（実際に置くのはタップ時）
      this.templateHoverPoint = this.toNormalized(ev.clientX, ev.clientY);
      return;
    }
    if (this.state.mode === "idle") return;
    const p = this.toNormalized(ev.clientX, ev.clientY);

    if (this.state.mode === "drawing" && this.state.activeMemoId) {
      this.store.addPointToLastStroke(this.state.activeMemoId, p);
    } else if (this.state.mode === "tracing") {
      this.state.lastPoint = p;
      const hitMemo = this.hitTestMemo(p);
      if (hitMemo) this.store.reviveMemo(hitMemo.id);
    } else if (this.state.mode === "moving" && this.state.movingMemoId && this.state.lastPoint) {
      const dx = p.x - this.state.lastPoint.x;
      const dy = p.y - this.state.lastPoint.y;
      this.store.translateMemo(this.state.movingMemoId, dx, dy, getFrameShape(this.frameShapeId).clamp);
      this.state.lastPoint = p;
    } else if (this.state.mode === "erasing") {
      this.state.lastPoint = p;
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.scale);
    }
  };

  private onPointerUp = (): void => {
    if (this.state.mode === "drawing") {
      this.scheduleSessionClose();
    }
    this.state.mode = "idle";
    this.state.tracingMemoId = null;
    this.state.movingMemoId = null;
    this.state.lastPoint = null;
  };

  render(now: number): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.interactive) {
      // 移動道具を選んでいる間はつかむ/つかんでいるカーソルにして、動かせることを示す。
      // テンプレート配置待ちの間は、次のタップで何かが置かれることが伝わるカーソルにする。
      const tool = this.getToolState().tool;
      this.canvas.style.cursor = this.pendingTemplate
        ? "copy"
        : tool === "move"
          ? this.state.mode === "moving"
            ? "grabbing"
            : "grab"
          : "crosshair";
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);
    ctx.translate(this.centerPx.x, this.centerPx.y);

    const shape = getFrameShape(this.frameShapeId);

    // 枠の外にはみ出さないようクリップ（外枠の線自体は中身の描画が終わってから、
    // クリップ境界より外側に描く——太い枠線をクリップ境界の上に中心線として描くと、
    // 線の内側半分が後から描くメモに隠れてしまうため）。
    ctx.save();
    ctx.clip(this.framePath);

    const r = this.scale;

    // Oval/Squareはクリップ境界がradius基準の正方形より外まで張り出すため、
    // 紙面もmaxReachぶん広めに塗る（クリップで結局切り取られるので広めに塗って
    // 問題はない）——でないと丸眼鏡以外で、枠の内側なのに紙が届かず背景色が
    // 透けて見える帯ができてしまう（ユーザー指摘）。
    drawRuledPaper(ctx, this.scale, this.scale * shape.maxReach);

    // 非対話（interactive: false）の間はstoreに常に何も無い（空のプレースホルダー
    // 専用インスタンス）ため、このループ・以下のグロー等は自然に何もしない。
    const activeMemos = this.store.getActive();
    for (const memo of activeMemos) {
      const opacity = this.store.opacityOf(memo, now);
      if (opacity <= 0) continue;
      renderMemoAt(ctx, memo, r, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    // なぞっている最中・移動中のかすかなグロー
    if ((this.state.mode === "tracing" || this.state.mode === "moving") && this.state.lastPoint) {
      const p = { x: this.state.lastPoint.x * r, y: this.state.lastPoint.y * r };
      const glowR = 22;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grad.addColorStop(0, TRACE_GLOW);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 消しゴムの当たり範囲を示すカーソル
    if (this.state.mode === "erasing" && this.state.lastPoint) {
      const p = { x: this.state.lastPoint.x * r, y: this.state.lastPoint.y * r };
      ctx.beginPath();
      ctx.arc(p.x, p.y, ERASER_RADIUS_PX, 0, Math.PI * 2);
      ctx.strokeStyle = ERASER_CURSOR;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // テンプレート配置待ちの間、置かれる場所のガイドを薄く表示する
    this.renderTemplateGuide(ctx, r);

    ctx.restore(); // clip

    // 外枠線。クリップ境界（this.scale）よりも線幅の半分だけ外側にオフセットした
    // 別パスに描くことで、太い線でも内側半分が中身の描画に隠れず、かつクリップされる
    // 描画可能領域自体も狭めない（通常キャンバスの既定値=1pxではオフセットは0.5pxのみ
    // で見た目の変化は無い）。
    ctx.strokeStyle = this.frameStrokeColor;
    ctx.lineWidth = this.frameStrokeWidth;
    ctx.stroke(this.strokePath);

    if (this.interactive && activeMemos.length === 0) {
      // 中心点
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = CENTER_DOT;
      ctx.fill();

      ctx.fillStyle = HINT_TEXT;
      ctx.font = "13px 'Noto Sans JP', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ドラッグで書き始める", 0, this.scale * 0.32);
    }

    ctx.restore(); // translate + setTransform
  }

  /** このインスタンスを使い終えたら呼ぶ。ResizeObserverと`window`に登録した
   *  ポインタリスナーを解除する——これを呼ばずにcanvas要素だけDOMから外すと、
   *  監視・リスナーがこのインスタンス（とstore等それが閉じ込めているもの）を
   *  永久に参照し続けてしまう（SMUIの右レンズはルーム切替のたびに新しい
   *  CircularCanvasへ差し替わるため、古い方を破棄せず放置するとリークする）。 */
  destroy(): void {
    this.resizeObserver.disconnect();
    if (this.interactive) {
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("pointercancel", this.onPointerUp);
    }
    this.textEditor?.remove();
    this.canvas.remove();
  }
}
