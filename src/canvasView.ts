import { FrameGeometry } from "./frameGeometry";
import { DEFAULT_FRAME_SHAPE_ID } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { DEFAULT_FRAME_PATTERN_ID } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { circleIntersectsBox, pointNearStrokes } from "./geometry";
import { renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import { renderReviveInfoBox } from "./reviveInfoBox";
import { getTemplateText } from "./templates";
import type { TemplateId } from "./templates";
import {
  fontPxForRender,
  measureTextBoxWidthPx,
  normalizedBoxSize,
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
/** ルーム未接続時（frameKind:"glasses" かつ interactive:false）の共有キャンバスの
 *  塗り。罫線は引かず、無地の白のまま（ユーザー指示）。 */
const GLASSES_PLACEHOLDER_FILL = "#ffffff";
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
   *  （SMUIの太いウェリントン風フレームだけがこれを上書きする）。太さは、
   *  キャンバスの実サイズ（px）を受け取ってウィンドウサイズに比例した値を
   *  返す関数でも渡せる——固定pxだと、ウィンドウが小さくなってもフレームの
   *  太さだけ変わらず、レンズに対して相対的に太すぎ/細すぎに見えてしまう
   *  （SMUIの共有キャンバス、ユーザー指摘）。 */
  frameStrokeColor?: string;
  frameStrokeWidth?: number | ((canvasSizePx: number) => number);
  /** falseの場合、ポインタ操作を一切受け付けない。SMUIの右レンズが共有キャンバスに
   *  まだ接続されていない間、白い罫線の紙だけを表示するプレースホルダー表現に使う
   *  （ユーザー指示）。既定true。 */
  interactive?: boolean;
  /** "single"(既定): 通常キャンバスと同じ、正方形コンテナに1つの形状（丸眼鏡/楕円/
   *  長方形）を描く。"glasses": 共有キャンバス専用、横長の矩形コンテナに左右レンズ+
   *  ブリッジを1つの連続領域として描く——frameShapeIdは「眼鏡のレンズスタイル」として
   *  解釈される（frameShape.tsのgetGlassesFrameShape参照）。 */
  frameKind?: "single" | "glasses";
  /** frameKind==="glasses"の時だけ意味を持つ、フレームの柄・質感（マット/べっ甲/
   *  クリア/木目）。省略時はDEFAULT_FRAME_PATTERN_ID。"single"（通常キャンバス
   *  タブ）は常にframeStrokeColorの単色のままで、この値は無視される。 */
  framePatternId?: FramePatternId;
}

export class CircularCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private resizeObserver: ResizeObserver;
  /** フレーム形状・サイズ計算・縁取りの描画をまとめて持つ（canvasView.tsが
   *  肥大化したための整理、Refactor。src/frameGeometry.ts参照）。 */
  private frame: FrameGeometry;
  private interactive: boolean;
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
  /** 今の「なぞる」ジェスチャー（pointerdownからpointerupまで）で、既に回復させた
   *  メモのID。なぞるたびに回復量には上限があるため（memoStore.tsのreviveMemo参照）、
   *  1回連続でなぞっている間にpointermoveが何度も発火しても、同じメモを何度も
   *  回復させて上限をすぐ食いつぶしてしまわないよう、メモ単位で1ジェスチャーにつき
   *  1回だけ呼ぶ。pointerdown/pointerupで作り直す・空にする。 */
  private tracedMemoIdsThisGesture = new Set<string>();
  /** PCでのマウスホバー用（ユーザー指示：タップ/ドラッグしなくてもホバーで見られる
   *  ようにしたい。タッチには「ホバー」に相当する状態が無いため、pointerType==="mouse"
   *  の間だけ更新する）。「なぞる」「移動」道具を選んでいる間、実際に触れて操作中
   *  でない（mode==="idle"）ときにポインタの下のメモを追いかける。 */
  private hoverInfoMemoId: string | null = null;
  private hoverInfoPoint: Point | null = null;

  constructor(
    container: HTMLElement,
    store: MemoStore,
    getToolState: () => ToolState,
    options: CircularCanvasOptions = {}
  ) {
    this.container = container;
    this.store = store;
    this.getToolState = getToolState;
    this.interactive = options.interactive ?? true;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "circle-canvas";
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.ctx = ctx;

    this.frame = new FrameGeometry(this.canvas, this.ctx, this.container, this.dpr, {
      frameShapeId: options.frameShapeId ?? DEFAULT_FRAME_SHAPE_ID,
      frameStrokeColor: options.frameStrokeColor ?? CIRCLE_BORDER,
      frameStrokeWidth: options.frameStrokeWidth ?? 1,
      frameKind: options.frameKind ?? "single",
      framePatternId: options.framePatternId ?? DEFAULT_FRAME_PATTERN_ID,
      contentScaleFactor: options.contentScaleFactor,
    });
    // ウィンドウのリサイズだけでなく、フッターの折り返しやフォント読み込みによる
    // レイアウト変化など、コンテナの実サイズが変わるあらゆるタイミングを動的に捉える
    this.resizeObserver = new ResizeObserver(() => this.frame.resize());
    this.resizeObserver.observe(this.container);

    if (this.interactive) {
      this.canvas.style.touchAction = "none";
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
      window.addEventListener("keydown", this.onGlobalKeyDown);
    }
  }
  /** フレーム形状（丸眼鏡/楕円/長方形）を切り替える。次のrender()から反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frame.setFrameShape(id);
  }

  /** フレームの柄・質感（マット/べっ甲/クリア/木目）を切り替える。
   *  frameKind==="single"では意味を持たない（常にframeStrokeColorの単色）。 */
  setFramePattern(id: FramePatternId): void {
    this.frame.setFramePattern(id);
  }

  /** 画面ピクセル座標 → 正規化座標（円の半径・長方形の半辺を1とする、中心が原点）。
   *  今選んでいるフレーム形状の輪郭の外にあれば内側に丸め込む。 */
  private toNormalized(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.frame.centerPx.x) / this.frame.scale;
    const y = (clientY - rect.top - this.frame.centerPx.y) / this.frame.scale;
    return this.frame.currentShape().clamp({ x, y });
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
    const threshold = HIT_THRESHOLD_PX / this.frame.scale;
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
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.frame.scale);
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

    if (tool === "trace") {
      // なぞる道具：既存のメモに触れた場合だけなぞって復活させる。移動道具と同じく
      // 何もない場所をタップしても何もしない——ペン等の描画操作とジェスチャーが
      // 混じらないよう、なぞる操作をこの専用道具に分離した（ユーザー指示）。
      this.tracedMemoIdsThisGesture.clear();
      if (hitMemo) {
        this.state.mode = "tracing";
        this.state.tracingMemoId = hitMemo.id;
        this.state.lastPoint = p;
        this.store.reviveMemo(hitMemo.id);
        this.tracedMemoIdsThisGesture.add(hitMemo.id);
      }
      return;
    }

    if (tool === "text") {
      // 既存のテキストメモに触れた場合はなぞって復活ではなく編集を開く
      // （なぞって復活させたい場合は専用の「なぞる」道具を使う）。
      if (hitMemo && hitMemo.kind === "text") {
        this.openTextEditor({ x: hitMemo.x, y: hitMemo.y }, hitMemo);
      } else {
        this.openTextEditor(p);
      }
      return;
    }

    // ペン・マーカー：既存メモの上に重なっても常に新規描画のみを行う
    // （なぞって復活はしない——なぞる操作は専用の「なぞる」道具に分離した）。
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
   * 確定する。Enterは確定（≒blur）、Shift+Enterは改行（ユーザー指示）。
   * editingMemoを渡すと既存のテキストメモの編集になる：元の位置・見た目（フォントサイズ・色）を
   * そのまま使い、内容だけ書き換えて更新する。空にして確定した場合はメモごと削除する。
   * Escapeで閉じた場合はキャンセル（新規なら何も作らず、編集なら元の内容のまま）。
   * initialTextは、何も選択していない状態でキーボード入力を始めたときに、その最初の
   * 1文字を最初から入った状態で開くために使う（onGlobalKeyDown参照。editingMemoと
   * 同時には使わない）。
   * fromBlindTypingは既定false。キーボードから始めた場合（onGlobalKeyDown）は
   * trueを渡し、その場で同期的にfocusする——次のフレームまで待つと、その間に
   * 発生した後続のキー入力（特に日本語IME変換中の2文字目以降）がこのtextarea
   * ではなく元のフォーカス先（たいていdocument.body）に向かってしまい、変換
   * 途中の文章が複数のマスに分裂して書き込まれてしまう不具合があった
   * （ユーザー報告・実機で再現確認）。タップ開始（onPointerDown）の場合は
   * ポインタ操作自体がフォーカスを動かし得るため、従来どおり次のフレームまで待つ。
   */
  private openTextEditor(
    anchor: Point,
    editingMemo: TextMemo | null = null,
    initialText?: string,
    fromBlindTyping = false
  ): void {
    if (this.textEditor) return;
    const { color: toolColor, fontSize: toolFontSize } = this.getToolState();
    const color = editingMemo?.color ?? toolColor;
    const fontSize = editingMemo?.fontSize ?? toolFontSize;
    const align = editingMemo?.align ?? "center";
    const canvasRect = this.canvas.getBoundingClientRect();
    const fontPx = fontPxForRender(fontSize, this.frame.scale);
    // 画面px⇄基準px（半径REFERENCE_RADIUS基準）の変換比率。可変幅ボックスの実際の
    // 幅は基準pxで測る（measureTextBoxWidthPx）ため、textareaに反映する際はこれで
    // 画面pxへ変換する。
    const toScreenPx = (referencePx: number) => (referencePx / REFERENCE_RADIUS) * this.frame.scale;
    const screenX = canvasRect.left + this.frame.centerPx.x + anchor.x * this.frame.scale;
    const screenY = canvasRect.top + this.frame.centerPx.y + anchor.y * this.frame.scale;

    const el = document.createElement("textarea");
    el.className = "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = editingMemo?.text ?? initialText ?? "";
    el.style.color = color;
    el.style.fontFamily = TEXT_FONT_FAMILY;
    el.style.fontSize = `${fontPx}px`;
    el.style.lineHeight = "1.4";
    el.style.textAlign = align;
    document.body.appendChild(el);
    this.textEditor = el;

    // 内容の実際の幅・高さに合わせてtextareaのサイズと位置を更新する（可変幅——
    // ユーザー指示：短い一言でも余白だらけの箱にならないよう、逆に長めの文でも
    // すぐ折り返さないよう、打った内容に応じて幅を変える）。アンカー点
    // (screenX, screenY)を中心に据えたまま、幅・高さが変わるたびに
    // left/topを再計算して中心がずれないようにする。
    const resizeToContent = () => {
      const boxWidthPx = toScreenPx(measureTextBoxWidthPx(this.ctx, el.value, fontSize));
      el.style.width = `${boxWidthPx}px`;
      el.style.left = `${screenX - boxWidthPx / 2}px`;
      el.style.height = "auto";
      const h = el.scrollHeight;
      el.style.height = `${h}px`;
      el.style.top = `${screenY - h / 2}px`;
    };
    resizeToContent();
    el.addEventListener("input", resizeToContent);

    const focusEl = () => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length); // 編集時・初期文字入り時はカーソルを末尾に
    };
    if (fromBlindTyping) {
      focusEl();
    } else {
      // フォーカスがずれるとblurが即座に発火し得るため、appendの次のフレームでfocusする
      requestAnimationFrame(focusEl);
    }

    // 日本語IMEの変換候補確定は、キー入力としてはEnterだが、テキスト全体の確定
    // ではない——kev.isComposingで判定するのが基本だが、変換確定のEnterで
    // ブラウザによってはisComposingが既にfalseに戻っている場合がある
    // （実機で再現確認：かな確定のEnterが「テキスト全体を確定するEnter」と
    // 区別できず、文章の途中でボックスが閉じてしまい、続きが新しいマスに分裂して
    // しまっていた）。compositionstart/endを自前で追跡し、「compositionendの
    // 直後（数十ms以内）のEnter」も変換確定の一部とみなして無視することで、
    // isComposingの値だけに頼るより確実に区別する。
    let composing = false;
    let lastCompositionEndAt = 0;
    const COMPOSITION_GRACE_MS = 50;
    el.addEventListener("compositionstart", () => {
      composing = true;
    });
    el.addEventListener("compositionend", () => {
      composing = false;
      lastCompositionEndAt = performance.now();
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
        const boxWidthPx = measureTextBoxWidthPx(this.ctx, value, fontSize);
        const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize, boxWidthPx);
        const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx);
        this.store.updateTextMemo(editingMemo.id, value, lines, width, height);
        return;
      }

      if (!value) return;
      const boxWidthPx = measureTextBoxWidthPx(this.ctx, value, fontSize);
      const lines = wrapTextAtReferenceScale(this.ctx, value, fontSize, boxWidthPx);
      const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx);
      this.store.createTextMemo(anchor, value, lines, fontSize, width, height, { color, lifespanDays: this.getToolState().lifespanDays });
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (kev) => {
      // 日本語IMEで変換候補を選んでいる最中のEscapeは「変換候補を閉じる」ためのキー入力であり、
      // 入力全体の取り消しではない。isComposingを見ずに反応すると、変換候補を1つ閉じたいだけ
      // なのに入力していた文字ごと消えてしまうバグになるため、IME変換中は無視する。
      if (kev.key === "Escape" && !kev.isComposing && !composing) {
        cancelled = true;
        el.blur();
        return;
      }
      // Enterは確定、Shift+Enterは改行（ユーザー指示）。IME変換中・変換確定
      // 直後のEnterはテキスト全体の確定ではないため無視する（上記コメント参照）。
      const justFinishedComposing = performance.now() - lastCompositionEndAt < COMPOSITION_GRACE_MS;
      if (kev.key === "Enter" && !kev.isComposing && !composing && kev.keyCode !== 229 && !justFinishedComposing) {
        if (!kev.shiftKey) {
          kev.preventDefault();
          el.blur(); // blurのcommitハンドラで確定させる
        }
        // Shift+EnterはpreventDefaultしない＝<textarea>既定の改行挿入に任せる
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
      recoveredMs: 0,
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
    if (this.state.mode === "idle") {
      this.updateHoverInfo(ev);
      return;
    }
    // 実際になぞる/移動を始めたら、ホバー表示はそちら（lastPoint基準）に譲る。
    this.hoverInfoMemoId = null;
    this.hoverInfoPoint = null;
    const p = this.toNormalized(ev.clientX, ev.clientY);

    if (this.state.mode === "drawing" && this.state.activeMemoId) {
      this.store.addPointToLastStroke(this.state.activeMemoId, p);
    } else if (this.state.mode === "tracing") {
      this.state.lastPoint = p;
      const hitMemo = this.hitTestMemo(p);
      if (hitMemo) {
        this.state.tracingMemoId = hitMemo.id;
        if (!this.tracedMemoIdsThisGesture.has(hitMemo.id)) {
          this.store.reviveMemo(hitMemo.id);
          this.tracedMemoIdsThisGesture.add(hitMemo.id);
        }
      }
    } else if (this.state.mode === "moving" && this.state.movingMemoId && this.state.lastPoint) {
      const dx = p.x - this.state.lastPoint.x;
      const dy = p.y - this.state.lastPoint.y;
      this.store.translateMemo(this.state.movingMemoId, dx, dy, this.frame.currentShape().clamp);
      this.state.lastPoint = p;
    } else if (this.state.mode === "erasing") {
      this.state.lastPoint = p;
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.frame.scale);
    }
  };

  /** 何も操作していない間（mode==="idle"）だけ呼ばれる。マウスが「なぞる」「移動」
   *  道具でメモの上に来たら、実際に触れなくても残り時間・回復できる時間の案内を
   *  出せるようにする（ユーザー指示：PCに限りホバーでも見られるように）。
   *  タッチには「押さずに触れる」状態が無いため、pointerType==="mouse"の
   *  ときだけ働く——タッチ側は従来どおりなぞる/移動を実際に始めたときに表示する。 */
  private updateHoverInfo(ev: PointerEvent): void {
    const tool = this.getToolState().tool;
    if (ev.pointerType !== "mouse" || (tool !== "trace" && tool !== "move")) {
      this.hoverInfoMemoId = null;
      this.hoverInfoPoint = null;
      return;
    }
    const p = this.toNormalized(ev.clientX, ev.clientY);
    const hitMemo = this.hitTestMemo(p);
    this.hoverInfoMemoId = hitMemo?.id ?? null;
    this.hoverInfoPoint = hitMemo ? p : null;
  }

  /** マウスがキャンバスの外に出たら、ホバー案内も消す（出しっぱなしにならないように）。 */
  private onPointerLeave = (): void => {
    this.hoverInfoMemoId = null;
    this.hoverInfoPoint = null;
  };

  private onPointerUp = (): void => {
    if (this.state.mode === "drawing") {
      this.scheduleSessionClose();
    }
    this.state.mode = "idle";
    this.state.tracingMemoId = null;
    this.state.movingMemoId = null;
    this.state.lastPoint = null;
    this.tracedMemoIdsThisGesture.clear();
  };

  /**
   * 何も選択していない状態（テキスト編集中でも、道具でのドラッグ中でもない）で
   * 印字可能な文字キーが押されたら、その場でテキスト入力を始める（ユーザー指示）。
   * 書き始める位置は常に円そのものの中心(0,0)——空いているマスを探す方式は、
   * 狙いどおりの見た目に細かく調整するのが難しくユーザー自身が調整を諦めたため
   * 単純化した。罫線の上に乗るかどうかも気にしない（ユーザー指示）。既存の文字と
   * 重なってもよい。ショートカット（Ctrl/Cmd/Alt併用）や、他の入力欄
   * （色ピッカー・招待リンクの入力欄など）にフォーカスがある間は横取りしない。
   */
  private onGlobalKeyDown = (ev: KeyboardEvent): void => {
    if (this.textEditor || this.pendingTemplate || this.state.mode !== "idle") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.length !== 1) return; // 矢印・Enter・Tab等の非文字キーは無視
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement | null)?.isContentEditable) {
      return;
    }
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視
    ev.preventDefault();
    // fromBlindTyping=true: 同期的にfocusする（詳しくはopenTextEditorのコメント参照）。
    this.openTextEditor({ x: 0, y: 0 }, null, ev.key, true);
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
        : tool === "move" || tool === "trace"
          ? this.state.mode === "moving" || this.state.mode === "tracing"
            ? "grabbing"
            : "grab"
          : "crosshair";
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);
    ctx.translate(this.frame.centerPx.x, this.frame.centerPx.y);

    const shape = this.frame.currentShape();

    // 枠は「strokePath（framePathを原点から一様拡大しただけの、ひとまわり
    // 大きい形状）を丸ごと塗りつぶし、その上からframePathでクリップした紙を
    // 重ねて内側を隠す」方式で描く——中身の描画が終わってから太い線を
    // クリップ境界の外側にstroke()する以前の方式は、直線から曲線へ切り替わる
    // 場所（squareの角、glassesの接合部の付け根）で「一様スケール」と「本来の
    // 一定距離オフセット」がわずかにズレ、縁取りと紙の間にごく細い隙間ができて
    // しまっていた（ユーザー指摘）。strokePathはframePathを原点から一様拡大した
    // ものなので、原点を含むstar-shapedな形状であるframePath/strokePathの性質上
    // strokePathは常にframePathを包含する——大小2つの塗りつぶしの差分として
    // 縁取りを表現すれば、このズレの影響を受けず隙間が生まれない。
    ctx.fillStyle = this.frame.frameStyle;
    ctx.fill(this.frame.strokePath);

    // 枠の外にはみ出さないようクリップ。
    ctx.save();
    ctx.clip(this.frame.framePath);

    const r = this.frame.scale;

    if (this.frame.frameKind === "glasses" && !this.interactive) {
      // ルーム未接続のプレースホルダー: 罫線を引かず無地の白で塗りつぶす。
      const half = r * shape.maxReach;
      ctx.fillStyle = GLASSES_PLACEHOLDER_FILL;
      ctx.fillRect(-half, -half, half * 2, half * 2);
    } else {
      // Oval/Squareはクリップ境界がradius基準の正方形より外まで張り出すため、
      // 紙面もmaxReachぶん広めに塗る（クリップで結局切り取られるので広めに塗って
      // 問題はない）——でないと丸眼鏡以外で、枠の内側なのに紙が届かず背景色が
      // 透けて見える帯ができてしまう（ユーザー指摘）。
      drawRuledPaper(ctx, r, r * shape.maxReach);
    }

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

    // なぞる/移動で実際に触れている間、またはPCでその道具にホバーしている間、
    // 残り時間・回復できる時間を背景つきのボックスで表示する（ユーザー指示）。
    // 回復量に生涯の上限を設けた（Issue #11、memoStore.tsのreviveMemo参照）
    // ので、「あとどれだけ回復させられるか」が見えないと利用者が分からない
    // ため。表示のロジック自体はreviveInfoBox.tsに切り出してある。
    renderReviveInfoBox(ctx, this.store, r, this.state, this.hoverInfoMemoId, this.hoverInfoPoint);

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

    // ブリッジ（接合部）は書き込める領域に含めない（clampToGlasses参照）ため、
    // 紙の罫線が透けて見えないよう、フレームと同じ柄・質感で塗りつぶした太い
    // バーとして見せる——構造的な連結部であり、書けない場所であることが
    // 見た目からも伝わるようにする（ユーザー指示）。クリップ(framePath)の外側
    // （ctx.restore()の後）で描く——strokePathのブリッジ部分の高さはframePathより
    // 大きい（接合部もframePathをoffsetぶん外側に広げた分だけ、紙で隠れない
    // フレーム色の帯がframePathの外側にできる）ため、framePathでクリップした
    // ままだとこの帯を覆いきれず、紙とフレーム色の境目が細い筋として見えて
    // しまっていた（ユーザー指摘・実測確認済み）。クリップの外で、strokePath
    // 自身のブリッジの高さぴったりに塗ることで、紙が透ける帯も境目の筋も
    // 出なくなる。
    if (this.frame.frameKind === "glasses") {
      this.frame.drawGlassesBridgeBar(ctx);
    }

    // ヒンジ（共有キャンバスの眼鏡形状だけの装飾）。クリップの外側に描く
    // 純粋な見た目要素で、メモの当たり判定・クランプとは無関係。
    if (this.frame.frameKind === "glasses") {
      this.frame.drawGlassesHinges(ctx, shape);
    }

    if (this.interactive && activeMemos.length === 0) {
      // 中心点
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = CENTER_DOT;
      ctx.fill();

      ctx.fillStyle = HINT_TEXT;
      ctx.font = "13px 'Noto Sans JP', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ドラッグで書き始める", 0, this.frame.scale * 0.32);
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
      this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("pointercancel", this.onPointerUp);
      window.removeEventListener("keydown", this.onGlobalKeyDown);
    }
    this.textEditor?.remove();
    this.canvas.remove();
  }
}
