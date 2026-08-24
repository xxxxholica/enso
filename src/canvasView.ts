import { createFadeVisibility } from "./fadeVisibility";
import { opacityAtTime } from "./fade";
import { FrameGeometry } from "./frameGeometry";
import { DEFAULT_FRAME_SHAPE_ID, GLASSES_CENTER_OFFSET } from "./frameShape";
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
  LINE_HEIGHT_MULTIPLIER,
  measureTextBoxWidthPx,
  normalizedBoxSize,
  TEMPLATE_FONT_SIZE,
  TEMPLATE_LINE_HEIGHT_MULTIPLIER,
  TEXT_FONT_FAMILY,
  wrapTextAtReferenceScale,
} from "./textLayout";
import { REFERENCE_RADIUS } from "./toolStyle";
import type { ToolbarTool } from "./toolbar";
import type { LifespanDays, Memo, Point, TextMemo } from "./types";

const CIRCLE_BORDER = "oklch(22% 0.012 55 / 0.08)";
const CENTER_DOT = "oklch(22% 0.012 55 / 0.18)";
const TRACE_GLOW = "oklch(22% 0.012 55 / 0.14)";
/** 空のキャンバスの案内（.canvas-empty-state、DOM側）を、円の中心からどれだけ
 *  下にずらして置くか（正規化単位）。以前canvasに直接fillTextしていたときと
 *  同じ位置。 */
const EMPTY_STATE_OFFSET_Y = 0.32;
/** ルーム未接続時（frameKind:"glasses" かつ interactive:false）の共有キャンバスの
 *  塗り。罫線は引かず、無地の白のまま（ユーザー指示）。 */
const GLASSES_PLACEHOLDER_FILL = "#ffffff";
const ERASER_CURSOR = "oklch(22% 0.012 55 / 0.3)";

/** 画面ピクセルでの当たり判定の許容範囲。円のサイズが変わっても指先の精度感が一定になるよう、
 *  実際に使うときは現在の半径で正規化してから比較する（normalizedThreshold = PX / radius）。 */
const HIT_THRESHOLD_PX = 12;
const ERASER_RADIUS_PX = 16;
/** 書き終えてから何 ms 操作がなければ「同じメモへの継続」を打ち切るか */
const WRITING_SESSION_IDLE_MS = 1400;
/** ピンチズームの倍率の範囲。1未満（フィット範囲より縮小して余白を見せる）は
 *  意味がないため許可しない。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 進行中のピンチ操作の起点（開始時の指間距離・中点・その時点のズーム/パン）。 */
interface PinchState {
  startDist: number;
  startZoom: number;
  startMid: Point;
  startPan: Point;
}

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
  mode: "idle" | "drawing" | "tracing" | "erasing" | "moving" | "pinching";
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
  /** メモが1つも無い空のキャンバスに出す「＋テンプレートを使用」ボタンが押されたときに
   *  呼ばれる（全画面のテンプレート選択を開く。templatePicker.ts、配線はmain.ts）。
   *  省略した場合はボタンを作らず、「ドラッグで書き始める」の案内だけを出す
   *  ——interactive:falseのプレースホルダーではそもそも空状態の案内自体を作らない。 */
  onRequestTemplatePicker?: () => void;
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
  /** null以外の間は、この絶対時刻(ms)における過去の状態を再現表示する
   *  「遡り」モード（rewindSelector.ts経由、main.tsから渡される）。ポインタ・
   *  キーボードでの操作はすべて無視し、道具バー側の見た目のグレーアウトと
   *  合わせて実際に描画・編集できないようにする（ユーザー指示）。 */
  private rewindAt: number | null = null;
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
  /** 空のキャンバスに重ねる案内（「ドラッグで書き始める」＋「＋テンプレートを使用」）。
   *  ボタンとして押せる・読み上げられる必要があるため、canvasへの描画ではなく本物の
   *  DOMで持つ。interactive:falseのプレースホルダーでは作らない（nullのまま）。 */
  private emptyStateEl: HTMLElement | null = null;
  private setEmptyStateVisible: ((show: boolean) => void) | null = null;
  private emptyStateShown = false;
  /** 今の「なぞる」ジェスチャー（pointerdownからpointerupまで）で、既に回復させた
   *  メモのID。なぞって復活には寿命に応じたクールタイムがある（memoStore.tsの
   *  reviveMemo参照）ため、1回連続でなぞっている間にpointermoveが何度も発火しても
   *  2回目以降はどのみちクールタイムでブロックされるが、ストアへの無駄な問い合わせ・
   *  書き込みを避けるため、メモ単位で1ジェスチャーにつき1回だけ呼ぶようにしている。
   *  pointerdown/pointerupで作り直す・空にする。 */
  private tracedMemoIdsThisGesture = new Set<string>();
  /** PCでのマウスホバー用（ユーザー指示：タップ/ドラッグしなくてもホバーで見られる
   *  ようにしたい。タッチには「ホバー」に相当する状態が無いため、pointerType==="mouse"
   *  の間だけ更新する）。「なぞる」「移動」道具を選んでいる間、実際に触れて操作中
   *  でない（mode==="idle"）ときにポインタの下のメモを追いかける。 */
  private hoverInfoMemoId: string | null = null;
  private hoverInfoPoint: Point | null = null;
  /** ブラウザ純正のページズームに頼らず、キャンバス自体を2本指でピンチ
   *  ズーム・パンできるようにする（ユーザー指示：スマホでのUX改善）。
   *  pointerIdごとの最新クライアント座標——2本目の指が乗るとピンチ開始。 */
  private activePointers = new Map<number, Point>();
  private viewZoom = 1;
  private viewPan: Point = { x: 0, y: 0 };
  private pinch: PinchState | null = null;

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
    // frameKind:"single"（個人キャンバス）は形状が常に丸固定なので、要素自体に
    // border-radius:50%を与えてbox-shadowを円形に沿わせられる（ユーザー指摘：
    // 初回の第一印象が弱い＝紙が背景に対して浮いて見えない）。SMUI側
    // （frameKind:"glasses"、楕円/長方形もあり得る）は形状が揃わないため対象外。
    this.canvas.className =
      (options.frameKind ?? "single") === "single" ? "circle-canvas circle-canvas--paper" : "circle-canvas";
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
    this.resizeObserver = new ResizeObserver(() => {
      this.frame.resize();
      // レイアウトが変わった後に古いズーム・パン量を引きずると見た目が破綻する
      // ため、コンテナサイズが変わるたびに単純にリセットする（画面回転など）。
      this.viewZoom = 1;
      this.viewPan = { x: 0, y: 0 };
      this.syncEmptyStatePosition();
    });
    this.resizeObserver.observe(this.container);

    if (this.interactive) {
      this.canvas.style.touchAction = "none";
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
      window.addEventListener("keydown", this.onGlobalKeyDown);
      // 空のキャンバスの案内は対話可能なキャンバスにだけ持たせる——ルーム未接続の
      // プレースホルダー（interactive:false）は無地の白い紙のままにする（ユーザー指示）。
      this.buildEmptyState(options.onRequestTemplatePicker);
    }
  }
  /** フレーム形状（丸眼鏡/楕円/長方形）を切り替える。次のrender()から反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frame.setFrameShape(id);
    this.syncEmptyStatePosition();
  }

  /** フレームの柄・質感（マット/べっ甲/クリア/木目）を切り替える。
   *  frameKind==="single"では意味を持たない（常にframeStrokeColorの単色）。 */
  setFramePattern(id: FramePatternId): void {
    this.frame.setFramePattern(id);
  }

  /** 振り返りスライダー（main.ts）から呼ぶ。t=nullで「たった今」＝通常のライブ
   *  表示に戻り、それ以外は過去の絶対時刻tにおける状態を再現表示する。遡り中に
   *  切り替えた場合は、進行中の操作（ドラッグ中の描画・なぞり・移動など）を
   *  そのまま続けさせず、いったん打ち切ってidleに戻す。 */
  setRewindAt(t: number | null): void {
    this.rewindAt = t;
    if (t !== null) {
      this.finishTextEditingIfOpen();
      this.closeWritingSession();
      this.state.mode = "idle";
      this.state.tracingMemoId = null;
      this.state.movingMemoId = null;
      this.state.lastPoint = null;
      this.hoverInfoMemoId = null;
      this.hoverInfoPoint = null;
    }
  }

  /** 空のキャンバスに重ねる案内を組み立てる。canvas要素の兄弟としてcontainerに
   *  入れる（position:absolute、containerに付けた.canvas-hostが基準）——画面固定
   *  (position:fixed)でbody直下に置く.text-editor-overlayと違い、この案内は
   *  出しっぱなしになる要素のため、タブを切り替えて#canvas-panel/#shared-panelが
   *  hiddenになったときに一緒に消えてくれるcontainerの子である方が確実
   *  （SMUIはルーム切替のたびにcontainerごと作り直すため、リークの心配もない）。 */
  private buildEmptyState(onRequestTemplatePicker?: () => void): void {
    this.container.classList.add("canvas-host");

    const el = document.createElement("div");
    el.className = "canvas-empty-state fade-visible";
    el.hidden = true;

    const hint = document.createElement("p");
    hint.className = "canvas-empty-hint";
    hint.textContent = "ドラッグで書き始める";
    el.appendChild(hint);

    // 「書き始める2つの選択肢」を並べて見せる（ユーザー指示：テンプレートを
    // 道具バーの1ボタンから、キャンバスを使い始める最初の選択肢へ格上げする）。
    if (onRequestTemplatePicker) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-btn canvas-empty-template-btn";
      btn.textContent = "＋テンプレートを使用";
      btn.addEventListener("click", () => onRequestTemplatePicker());
      el.appendChild(btn);
    }

    this.container.appendChild(el);
    this.emptyStateEl = el;
    this.setEmptyStateVisible = createFadeVisibility(el);
    this.syncEmptyStatePosition();
  }

  /** 案内を「書ける領域の中心のすこし下」に合わせ直す。位置が変わるのはコンテナの
   *  リサイズとフレーム形状の切り替え（どちらもframe.resize()を通る）だけなので、
   *  renderの毎フレームではなくそのタイミングだけで呼ぶ（smuiViewのrepositionStatus
   *  と同じ、毎フレームのレイアウト読み出しを避ける流儀）。 */
  private syncEmptyStatePosition(): void {
    const el = this.emptyStateEl;
    if (!el) return;
    // "glasses"（SMUI）の原点はブリッジ（書けない接合部）の真上に来るため、案内も
    // 右レンズの中心へずらす——案内メッセージ(smuiView.ts)を右レンズに寄せているのと
    // 同じ考え方。"single"（通常キャンバス）ではdx=0のまま円の中心を使う。
    const scale = this.effectiveScale();
    const dx = this.frame.frameKind === "glasses" ? GLASSES_CENTER_OFFSET * scale : 0;
    const dy = EMPTY_STATE_OFFSET_Y * scale;
    el.style.left = `${this.canvas.offsetLeft + this.frame.centerPx.x + this.viewPan.x + dx}px`;
    el.style.top = `${this.canvas.offsetTop + this.frame.centerPx.y + this.viewPan.y + dy}px`;
  }

  /** ピンチズームの倍率を加味した、正規化座標→画面px変換の実効スケール。 */
  private effectiveScale(): number {
    return this.frame.scale * this.viewZoom;
  }

  /** 案内を出す条件（メモが1つも無い／テキスト入力中でない）を毎フレーム見直す
   *  （テンプレートは選んだ瞬間に置かれるため、この条件だけで足りる）。
   *  メモの増減はクラウド同期・共有ルームのポーリング・寿命切れなど
   *  通知の無い経路でも起きるため、renderのついでに見るのがいちばん確実——DOMに触るのは
   *  表示・非表示が実際に切り替わった瞬間だけにする。 */
  private syncEmptyState(activeMemoCount: number): void {
    if (!this.emptyStateEl || !this.setEmptyStateVisible) return;
    // 過去を遡って見ている間は書き込めないため、「ドラッグで書き始める」案内は出さない。
    const show = this.rewindAt === null && activeMemoCount === 0 && !this.textEditor;
    if (show === this.emptyStateShown) return;
    this.emptyStateShown = show;
    if (show) this.syncEmptyStatePosition(); // 隠れている間にリサイズされていた場合に備える
    this.setEmptyStateVisible(show);
  }

  /** 画面ピクセル座標 → 正規化座標（円の半径・長方形の半辺を1とする、中心が原点）。
   *  今選んでいるフレーム形状の輪郭の外にあれば内側に丸め込む。 */
  private toNormalized(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.effectiveScale();
    const x = (clientX - rect.left - this.frame.centerPx.x - this.viewPan.x) / scale;
    const y = (clientY - rect.top - this.frame.centerPx.y - this.viewPan.y) / scale;
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
  }

  private hitTestMemo(p: Point): Memo | null {
    const threshold = HIT_THRESHOLD_PX / this.effectiveScale();
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
    if (this.rewindAt !== null) return; // 過去を遡って見ている間は描画・操作を受け付けない
    // 指がキャンバス外に多少はみ出してもmove/upを確実に拾えるようにする
    // （pointerdown/moveはcanvas要素、pointerup/cancelはwindowという非対称な
    // 登録なので、captureで一本化しておく——特にピンチ中に有効）。
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ブラウザ差異等でcaptureに失敗しても致命的ではないため無視する。
    }
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.activePointers.size === 2) {
      this.beginPinch();
      return;
    }
    if (this.activePointers.size > 2) return; // 3本目以降の指は無視（既存のピンチを継続）

    if (this.textEditor) return; // テキスト入力中は他の操作を受け付けない（blurで確定してから）
    const p = this.toNormalized(ev.clientX, ev.clientY);

    const tool = this.getToolState().tool;

    if (tool === "eraser") {
      this.state.mode = "erasing";
      this.state.lastPoint = p;
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.effectiveScale());
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

  /** 2本目の指が乗った瞬間に呼ぶ。進行中の1本指ジェスチャー（描画・消しゴム・
   *  なぞる・移動）があれば打ち切ってからピンチの起点を記録する。 */
  private beginPinch(): void {
    if (this.state.mode !== "idle" && this.state.mode !== "pinching") {
      this.endSinglePointerGesture();
    }
    const [a, b] = [...this.activePointers.values()];
    this.state.mode = "pinching";
    this.pinch = {
      startDist: pointerDistance(a, b),
      startZoom: this.viewZoom,
      startMid: pointerMidpoint(a, b),
      startPan: { ...this.viewPan },
    };
  }

  /** ピンチ中、いずれかの指が動くたびに呼ぶ。指間距離の変化比でズーム、
   *  中点の移動量でパンを更新する。 */
  private updatePinch(): void {
    if (!this.pinch || this.activePointers.size < 2) return;
    const [a, b] = [...this.activePointers.values()];
    const dist = pointerDistance(a, b);
    const mid = pointerMidpoint(a, b);
    this.viewZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.pinch.startZoom * (dist / this.pinch.startDist)));
    const pan = {
      x: this.pinch.startPan.x + (mid.x - this.pinch.startMid.x),
      y: this.pinch.startPan.y + (mid.y - this.pinch.startMid.y),
    };
    this.viewPan = this.viewZoom <= MIN_ZOOM ? { x: 0, y: 0 } : this.clampPan(pan);
    this.syncEmptyStatePosition();
  }

  /** 円が完全に画面外へ出てしまわないよう、パン量をズーム倍率に応じた範囲に
   *  収める（ズームしていないときはパン自体を許可しない）。 */
  private clampPan(pan: Point): Point {
    const maxOffset = this.frame.scale * (this.viewZoom - 1);
    if (maxOffset <= 0) return { x: 0, y: 0 };
    const mag = Math.hypot(pan.x, pan.y);
    if (mag <= maxOffset) return pan;
    const k = maxOffset / mag;
    return { x: pan.x * k, y: pan.y * k };
  }

  /** 1本指ジェスチャー（描画・消しゴム・なぞる・移動）の後始末。onPointerUpと
   *  「2本目の指が乗って途中でピンチに切り替わった」場合の両方から呼ぶ。 */
  private endSinglePointerGesture(): void {
    if (this.state.mode === "drawing") {
      // ドラッグせずに離した一瞬のクリックは、線としては何も描けていない
      // （renderMemoAtがstroke.length<2のメモを描画対象から除外する）ため、
      // ストア側にも「見えないメモ」を残さない（詳しくはdiscardTrailingSinglePointStroke参照）。
      if (this.state.activeMemoId && this.store.discardTrailingSinglePointStroke(this.state.activeMemoId)) {
        this.state.activeMemoId = null;
      }
      this.scheduleSessionClose();
    }
    this.state.mode = "idle";
    this.state.tracingMemoId = null;
    this.state.movingMemoId = null;
    this.state.lastPoint = null;
    this.tracedMemoIdsThisGesture.clear();
  }

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
    const lineHeight = editingMemo?.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const canvasRect = this.canvas.getBoundingClientRect();
    const scale = this.effectiveScale();
    const fontPx = fontPxForRender(fontSize, scale);
    // 画面px⇄基準px（半径REFERENCE_RADIUS基準）の変換比率。可変幅ボックスの実際の
    // 幅は基準pxで測る（measureTextBoxWidthPx）ため、textareaに反映する際はこれで
    // 画面pxへ変換する。ピンチズーム中でも見た目の位置・大きさがキャンバス側の
    // 描画とずれないよう、frame.scaleではなく実効スケール（ズーム込み）を使う。
    const toScreenPx = (referencePx: number) => (referencePx / REFERENCE_RADIUS) * scale;
    const screenX = canvasRect.left + this.frame.centerPx.x + this.viewPan.x + anchor.x * scale;
    const screenY = canvasRect.top + this.frame.centerPx.y + this.viewPan.y + anchor.y * scale;

    const el = document.createElement("textarea");
    el.className = "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = editingMemo?.text ?? initialText ?? "";
    el.style.color = color;
    el.style.fontFamily = TEXT_FONT_FAMILY;
    el.style.fontSize = `${fontPx}px`;
    el.style.lineHeight = `${lineHeight}`;
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
        const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx, lineHeight);
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
   * 指定したテンプレートを、常に画面（形状）の中心(0,0)に置く（ユーザー指示：
   * 配置は最初から画面中央に）。以前はタップした場所に自由配置していたが、
   * 置く場所を選ぶタップの手順自体を無くし、選んだ瞬間にそのまま中心へ置く。
   * 項目は空欄のまま——書き込むのは通常のテキストメモの編集と同じ操作でよい。
   * 幅は実際の文面の最長行に合わせる（measureTextBoxWidthPx、編集時と同じ計算）
   * ——形状の横幅ぎりぎりまで箱を広げると、行ごとに幅が違う文面を左揃えにした
   * とき（中央揃えだと左端がガタつくため左揃え——ユーザー指示）文字が箱の左に
   * 偏り、中心(0,0)に置いたつもりでも画面上は中央からずれて見えてしまうため
   * （実測・見た目で確認済み）。文面の幅に合わせることで、左揃えのまま見た目も
   * 中心に収まる。
   *
   * 文字サイズは道具バーの現在値ではなく常にTEMPLATE_FONT_SIZE固定にする
   * （ユーザー指示：テンプレートを配置するときのみより大きいフォントサイズに
   * したい——道具バーの最大ステップよりもさらに大きい専用の値）。
   *
   * 置いた直後、そのままテキスト編集状態にする（ユーザー指示：テンプレートを
   * 選択した際に配置したテンプレートのテキスト編集状態にしてほしい）——空欄を
   * 書き込むまでの一手間（タップして編集を開く）を省く。編集用の<textarea>も
   * 同じmeasureTextBoxWidthPxで幅を決めるため、開いた瞬間に盤面の描画とぴったり
   * 重なる。
   *
   * 行間は通常のLINE_HEIGHT_MULTIPLIERではなく、少し狭いTEMPLATE_LINE_HEIGHT_MULTIPLIER
   * にする（ユーザー指示：テンプレートのみ行間を少し狭くしたい）。memoに保存して
   * おくことで、renderMemoAt・この後開く編集用<textarea>のline-height・再編集時の
   * 高さ再計算のすべてが同じ狭さのまま揃う。
   */
  beginPlacingTemplate(id: TemplateId): void {
    const text = getTemplateText(id);
    const { color, lifespanDays } = this.getToolState();
    const fontSize = TEMPLATE_FONT_SIZE;
    const lineHeight = TEMPLATE_LINE_HEIGHT_MULTIPLIER;
    const boxWidthPx = measureTextBoxWidthPx(this.ctx, text, fontSize);
    const lines = wrapTextAtReferenceScale(this.ctx, text, fontSize, boxWidthPx);
    const { width, height } = normalizedBoxSize(fontSize, lines.length, boxWidthPx, lineHeight);
    const memo = this.store.createTextMemo({ x: 0, y: 0 }, text, lines, fontSize, width, height, {
      color,
      lifespanDays,
      align: "left",
      lineHeight,
    });
    this.openTextEditor({ x: 0, y: 0 }, memo);
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.activePointers.has(ev.pointerId)) {
      this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }
    if (this.state.mode === "pinching") {
      this.updatePinch();
      return;
    }
    if (this.activePointers.size >= 2) return; // 3本目以降の指の動きは無視

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
      this.store.eraseAt(p, ERASER_RADIUS_PX / this.effectiveScale());
    }
  };

  /** 何も操作していない間（mode==="idle"）だけ呼ばれる。マウスが「なぞる」「移動」
   *  道具でメモの上に来たら、実際に触れなくても残り時間・回復できる時間の案内を
   *  出せるようにする（ユーザー指示：PCに限りホバーでも見られるように）。
   *  タッチには「押さずに触れる」状態が無いため、pointerType==="mouse"の
   *  ときだけ働く——タッチ側は従来どおりなぞる/移動を実際に始めたときに表示する。 */
  private updateHoverInfo(ev: PointerEvent): void {
    const tool = this.getToolState().tool;
    if (this.rewindAt !== null || ev.pointerType !== "mouse" || (tool !== "trace" && tool !== "move")) {
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

  private onPointerUp = (ev: PointerEvent): void => {
    this.activePointers.delete(ev.pointerId);
    if (this.state.mode === "pinching") {
      // 1本の指を離しただけでは描画を再開しない——残り1本になったら
      // いったんidleに戻し、新しいpointerdownから仕切り直す。
      if (this.activePointers.size < 2) {
        this.state.mode = "idle";
        this.pinch = null;
      }
      return;
    }
    this.endSinglePointerGesture();
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
    if (this.rewindAt !== null || this.textEditor || this.state.mode !== "idle") return;
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
      if (this.rewindAt !== null) {
        // 過去を遡って見ている間は操作できないため、道具に応じたカーソルは出さない。
        this.canvas.style.cursor = "default";
      } else {
        // 移動道具を選んでいる間はつかむ/つかんでいるカーソルにして、動かせることを示す。
        const tool = this.getToolState().tool;
        this.canvas.style.cursor =
          tool === "move" || tool === "trace"
            ? this.state.mode === "moving" || this.state.mode === "tracing"
              ? "grabbing"
              : "grab"
            : "crosshair";
      }
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w / this.dpr, h / this.dpr);
    ctx.translate(this.frame.centerPx.x + this.viewPan.x, this.frame.centerPx.y + this.viewPan.y);
    // ピンチズームの倍率をここで1回だけ適用する。以降の描画（メモのストローク・
    // 罫線紙・フレームのクリップパス・グロー・消しゴムカーソル等）はすべて
    // このtransformの上に乗るため、個々の描画コードは一切変更不要で自動的に
    // ズームが反映される（`r = this.frame.scale`もこれまで通りでよい）。
    ctx.scale(this.viewZoom, this.viewZoom);

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
    // 遡り中（rewindAt !== null）は、消滅済みメモも含めた全メモを対象に、
    // traceHistoryから過去の時刻tにおける不透明度を再現する（旧ArchiveViewの
    // renderPreviewAtと同じロジック。fade.tsのopacityAtTime参照）。
    const rewindAt = this.rewindAt;
    const memosToRender = rewindAt !== null ? this.store.getAll() : activeMemos;
    for (const memo of memosToRender) {
      const opacity =
        rewindAt !== null ? opacityAtTime(memo.traceHistory, memo.lifespanDays, rewindAt) : this.store.opacityOf(memo, now);
      if (opacity === null || opacity <= 0) continue;
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
    // 残り時間・次に復活できるまでの時間を背景つきのボックスで表示する
    // （ユーザー指示）。なぞって復活にはクールタイムがある（Issue #11、
    // memoStore.tsのreviveMemo参照）ので、「次にいつなぞれるか」が見えないと
    // 利用者が分からないため。表示のロジック自体はreviveInfoBox.tsに切り出してある。
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

    if (this.interactive && rewindAt === null && activeMemos.length === 0) {
      // 中心点（ここが書ける領域の中心、という目印）。文字の案内はDOM側
      // （.canvas-empty-state、syncEmptyState参照）へ移したので、canvasに描くのは
      // この点だけ。"glasses"では原点がブリッジ（書けない接合部）の真上なので、
      // DOM側の案内と同じ右レンズの中心に打つ。
      const dotX = this.frame.frameKind === "glasses" ? GLASSES_CENTER_OFFSET * r : 0;
      ctx.beginPath();
      ctx.arc(dotX, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = CENTER_DOT;
      ctx.fill();
    }

    ctx.restore(); // translate + setTransform

    // DOM側の案内（ドラッグで書き始める／＋テンプレートを使用）の出し入れ。
    this.syncEmptyState(activeMemos.length);
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
    this.emptyStateEl?.remove();
    this.container.classList.remove("canvas-host");
    this.canvas.remove();
  }
}
