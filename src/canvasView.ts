import { createFadeVisibility } from "./fadeVisibility";
import { opacityAtTime } from "./fade";
import { FrameGeometry } from "./frameGeometry";
import { DEFAULT_FRAME_SHAPE_ID, GLASSES_CENTER_OFFSET } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { DEFAULT_FRAME_PATTERN_ID } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { circleIntersectsBox, pointNearStrokes } from "./geometry";
import { drawRadialGlow, renderHeatGlow, renderMemoAt } from "./memoRenderer";
import type { MemoStore } from "./memoStore";
import { drawRuledPaper } from "./paper";
import { currentReviveInfoTarget } from "./reviveInfoTarget";
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
/** 掴んだ地点（回転の軸）から半径がこれ未満の間は、なぞる操作扱いの微小な
 *  手ブレでも回転角が暴れてしまうため、回転の積算自体を行わない。 */
const ROTATE_MIN_RADIUS_PX = 24;
/** 選択道具でメモを掴んで振り回す操作の「1段」にあたる回転量（1回転）。
 *  これ未満の回転は普通のドラッグ移動の揺れとみなし、何も起きない
 *  （ユーザー指示：1回転させるごとに1段ぶん進む/戻る、なるべく誤発火しない値）。 */
const ROTATE_STEP_RAD = Math.PI * 2;
/** 1段（1回転）ぶんの基準となる時間量。以前は寿命(1日)の15%（=3.6時間）だったが、
 *  復活しすぎるとの指摘を受け、寿命に対する割合ではなく絶対量の1時間に
 *  変更した（ユーザー指示：1周1時間にして）。同じ向きに連続で振り回すほど
 *  ROTATE_ACCEL_PER_STEPぶんずつ加速し、ROTATE_MAX_STEP_MSで打ち止める
 *  （ユーザー指示：連続で回されたら段々加速するように）。 */
const ROTATE_STEP_MS = 60 * 60 * 1000;
/** 同じ向きに連続する段（rotateStreak）が1つ増えるごとに、1段あたりの時間量に
 *  上乗せする量。streak=1（1段目）はROTATE_STEP_MSそのまま、streak=2で+0.5時間
 *  …と線形に増える。 */
const ROTATE_ACCEL_PER_STEP_MS = ROTATE_STEP_MS * 0.5;
/** 1段あたりの時間量の上限（ROTATE_STEP_MSの4倍=4時間）。加速し続けても
 *  1回の振り回しで寿命(1日)を大きく超えて飛ばないよう頭打ちにする。 */
const ROTATE_MAX_STEP_MS = ROTATE_STEP_MS * 4;

/** 同じ向きに連続してstreak段発火した時点での、1段あたりの時間量（ms）。 */
function rotateStepAmountMs(streak: number): number {
  return Math.min(ROTATE_MAX_STEP_MS, ROTATE_STEP_MS + (streak - 1) * ROTATE_ACCEL_PER_STEP_MS);
}
/** 書き終えてから何 ms 操作がなければ「同じメモへの継続」を打ち切るか */
const WRITING_SESSION_IDLE_MS = 1400;
/** ピンチズームの倍率の範囲。1未満（フィット範囲より縮小して余白を見せる）は
 *  意味がないため許可しない。上限は、キャンバス要素がヘッダー/ツールバーの
 *  下まで広がった（issue #83）後、最大までズーム+パンした時にその下まで
 *  確実に絵が届くよう2倍から引き上げた（ユーザー指摘：2倍だとギリギリ
 *  届かないことがある）。 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

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
  /** 消しゴムの当たり判定半径（画面px、キャンバスの大きさに関わらず一定）。
   *  消しゴム道具の時のみ使う（ユーザー指示：GoodNotesのようにバーで変えたい）。 */
  eraserRadius: number;
}

interface DrawState {
  mode: "idle" | "drawing" | "tracing" | "erasing" | "moving" | "pinching";
  activeMemoId: string | null;
  tracingMemoId: string | null;
  /** 移動道具でドラッグ中のメモID。ドラッグ中はポインタが動くたびに差分移動を積む。 */
  movingMemoId: string | null;
  idleTimer: number | null;
  lastPoint: Point | null;
  /** 移動道具で掴んだ瞬間の座標（固定）。ドラッグ中、この点を中心に
   *  ポインタがどれだけ振り回されたか（rotateAccumRad）を測る基準にする
   *  ——メモ自体は従来通りポインタに追従して動くが、回転の軸はこの掴んだ
   *  瞬間の座標に固定し続ける（ユーザー指示）。movingMemoIdがnullの間は無効。 */
  rotateAnchor: Point | null;
  /** rotateAnchorを中心に積算した符号付き回転角（ラジアン、時計回りが正——
   *  toNormalizedはy-down座標系なのでatan2の増加＝時計回り）。振り回している
   *  間ずっと積算し続け、逆に回せば減る（＝進める/戻すを行き来できる）。 */
  rotateAccumRad: number;
  /** rotateAccumRadのうち、既にnudgeMemoClockとして発火し終えた1回転分の
   *  段数（symmetric、負にもなる）。新しい段（1回転ぶんの整数部分）に達する
   *  たびに差分ぶんだけ発火し、クールタイムなしで何度でも・逆回転すれば
   *  即座に打ち消せるようにする（ユーザー指示：復活の制限を撤廃し、
   *  自由に時間を進める・戻すができるように）。 */
  rotateFiredSteps: number;
  /** 同じ向きに連続で発火した段数（符号付き、正=時計回り・負=反時計回り）。
   *  向きを変えた瞬間に±1へ振り直す——連続で同じ向きに振り回し続けるほど
   *  1段あたりの効果が加速する（ユーザー指示）。 */
  rotateStreak: number;
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
  /** 選択道具で掴んで振り回す操作の判定を、既定（ROTATE_MIN_RADIUS_PX/
   *  ROTATE_STEP_RAD、本物のキャンバス相当）より緩めたい呼び出し元向け。
   *  使い方ページの練習用サンドボックス（tutorialSandbox.ts）は、本物より
   *  ひとまわり小さい円の中でこのジェスチャーを初めて教える場面のため、
   *  1回転まるごと・半径24px以上という本物の基準のままだと、慣れていない
   *  ユーザーには難しすぎることがある（ユーザー報告：手順で止まってしまう）。
   *  省略時はいずれも本物と同じ値になり、既存の呼び出し元の挙動は変わらない。 */
  rotateStepRad?: number;
  rotateMinRadiusPx?: number;
  /** 共有キャンバスの投票フェーズ(voting)専用: 指定された間はupdateRotationGestureが
   *  nudgeMemoClock(時間巻き戻し)を呼ぶ代わりにこちらを呼ぶ（回転方向・連続回数を
   *  問わず、1回転につき1回）。setRotationVoteHandlerで実行中に差し替えられるため、
   *  ここでの初期値指定は必須ではない。 */
  onRotationStep?: (memoId: string) => void;
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
    rotateAnchor: null,
    rotateAccumRad: 0,
    rotateFiredSteps: 0,
    rotateStreak: 0,
  };

  public getToolState: () => ToolState;
  private container: HTMLElement;
  private store: MemoStore;
  private textEditor: HTMLTextAreaElement | null = null;
  /** 開いているtext-editor-overlayを、フレームの状態（centerPx/scale/viewPan）が
   *  変わるたびに正しい画面位置へ再配置するための関数（openTextEditorが設定・
   *  閉じるときにnullへ戻す）。モバイルでキーボードが開くとcontainerの実サイズが
   *  変わりResizeObserverが発火するが、オーバーレイの位置はopenTextEditor実行時
   *  一度きりの計算のままだったため、タップした位置から離れた所に表示される
   *  不具合があった（ユーザー指摘）。ResizeObserverのコールバックからこれを
   *  呼び直すことで、フレームが動いてもオーバーレイを追従させる。 */
  private repositionTextEditor: (() => void) | null = null;
  /** openTextEditorがhtml/bodyのoverflowを固定している間、元の値に戻すための関数
   *  （閉じるときにnullへ戻す）。理由はopenTextEditor内のコメント参照。 */
  private restoreBodyScroll: (() => void) | null = null;
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
  /** 消しゴムツールでの当たり範囲プレビュー用（ユーザー指示：クリックして実際に
   *  消し始めるまで、消しゴムの大きさが分からない問題を解消したい）。上のhoverInfo
   *  と同じ理由でmouseの間だけ、実際に消し始める前（mode==="idle"）に更新する
   *  ——タッチには「押さずに触れる」状態が無いため、そもそも事前確認ができない。
   *  実際に消している最中（mode==="erasing"）のカーソル表示はstate.lastPoint
   *  を使う既存の仕組みのままなので、ここでは触らない。 */
  private eraserHoverPoint: Point | null = null;
  /** 1本指ジェスチャー（描画・消しゴム・なぞる・移動）を今進行させている
   *  ポインタのid（nullなら未使用）。キャンバス要素上のpointerdownでのみ
   *  設定される——ピンチ中はbeginPinch()がnullに戻し、以後の1本指ジェス
   *  チャーの開始・継続を無効化する。 */
  private activePointerId: number | null = null;
  /** ブラウザ純正のページズームに頼らず、キャンバス自体を2本指でピンチ
   *  ズーム・パンできるようにする（ユーザー指示：スマホでのUX改善。さらに
   *  「キャンバスの外側どこでタッチしても構わない」という指示により、
   *  canvas要素にのみ登録されたactivePointerIdとは別に、windowレベルで
   *  すべてのpointerdown/move/up/cancelを監視して集める）。pointerIdごとの
   *  最新クライアント座標——2本目の指が乗るとピンチ開始。 */
  private pinchPointers = new Map<number, Point>();
  private viewZoom = 1;
  private viewPan: Point = { x: 0, y: 0 };
  private pinch: PinchState | null = null;
  /** 掴んで振り回す操作の判定基準（CircularCanvasOptions.rotateStepRad/
   *  rotateMinRadiusPx参照）。省略時は本物のキャンバスと同じROTATE_STEP_RAD/
   *  ROTATE_MIN_RADIUS_PXになる。 */
  private rotateStepRad: number;
  private rotateMinRadiusPx: number;
  /** setRotationVoteHandler参照。null以外の間、掴んで回転は時間巻き戻しではなく
   *  熱量(投票)カウントとして扱われる。 */
  private rotationVoteHandler: ((memoId: string) => void) | null = null;
  /** 共有キャンバスの共同アイデア出しセッション、フェーズ②(議論)で
   *  ルームマスター以外の操作を止めるためのロック(setLocked参照)。
   *  rewindAtと違い描画自体は普段どおり続ける（見るだけはできる）。 */
  private locked = false;

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
    this.rotateStepRad = options.rotateStepRad ?? ROTATE_STEP_RAD;
    this.rotateMinRadiusPx = options.rotateMinRadiusPx ?? ROTATE_MIN_RADIUS_PX;
    this.rotationVoteHandler = options.onRotationStep ?? null;
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
    this.resizeObserver = new ResizeObserver(() => {
      this.frame.resize();
      // レイアウトが変わった後に古いズーム・パン量を引きずると見た目が破綻する
      // ため、コンテナサイズが変わるたびに単純にリセットする（画面回転など）。
      this.viewZoom = 1;
      this.viewPan = { x: 0, y: 0 };
      this.syncEmptyStatePosition();
      // モバイルでソフトキーボードが開閉するとcontainerの実サイズが変わり
      // ここが発火する。text-editor-overlayを開いたままだと、位置がタップ時点の
      // 古いフレームのまま取り残されてしまうため、開いていれば今のフレームに
      // 合わせて再配置する（ユーザー指摘：タップ位置から離れた所に表示される）。
      this.repositionTextEditor?.();
    });
    this.resizeObserver.observe(this.container);

    if (this.interactive) {
      // キャンバス自身は独自のタッチ操作（描画・消しゴム等）を全て自前で処理する
      // ため、ブラウザ純正のタッチ操作（スクロール等）は不要——それ以外の画面
      // 全体については、style.cssのhtml,bodyにtouch-action: pan-x pan-yを
      // 設定してあり、ページのどこでピンチしてもブラウザ純正のピンチズームには
      // 奪われず、下のonGlobalPointerDown等の自前のピンチズームだけが働く
      // （スクロールは引き続き効く。ユーザー指示：「画面のどこでもズームを
      // 実行可能にしたい」）。
      this.canvas.style.touchAction = "none";
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("pointercancel", this.onPointerUp);
      window.addEventListener("keydown", this.onGlobalKeyDown);
      // ページのどこでタッチしても2本指ならこのキャンバスをピンチズームできる
      // ように、キャンバス要素の外側で発生した指も含めてwindowレベルで監視する。
      window.addEventListener("pointerdown", this.onGlobalPointerDown);
      window.addEventListener("pointermove", this.onGlobalPointerMove);
      window.addEventListener("pointerup", this.onGlobalPointerUp);
      window.addEventListener("pointercancel", this.onGlobalPointerUp);
      window.visualViewport?.addEventListener("resize", this.onVisualViewportChange);
      window.visualViewport?.addEventListener("scroll", this.onVisualViewportChange);
      // 空のキャンバスの案内は対話可能なキャンバスにだけ持たせる——ルーム未接続の
      // プレースホルダー（interactive:false）は無地の白い紙のままにする（ユーザー指示）。
      this.buildEmptyState(options.onRequestTemplatePicker);
    }
  }
  /** 投票フェーズ(voting)の間だけ渡す。null(既定)に戻すと通常の時間巻き戻し操作に戻る。 */
  setRotationVoteHandler(handler: ((memoId: string) => void) | null): void {
    this.rotationVoteHandler = handler;
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
      this.state.rotateAnchor = null;
      this.state.rotateAccumRad = 0;
      this.state.rotateFiredSteps = 0;
      this.state.rotateStreak = 0;
      this.hoverInfoMemoId = null;
      this.hoverInfoPoint = null;
    }
  }

  /** 共有キャンバスの共同アイデア出しセッション、フェーズ②(議論)でルームマスター
   *  以外の操作を止めるために呼ぶ（main.ts/smuiView.ts）。setRewindAtと違い、
   *  進行中の操作を打ち切ったりはしない——ロックされるのは新しい操作の開始だけ
   *  （onPointerDown参照）。 */
  setLocked(locked: boolean): void {
    this.locked = locked;
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
      btn.className = "pill-btn pill-btn--primary canvas-empty-template-btn";
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
    if (this.rewindAt !== null || this.locked) return; // 過去を遡って見ている間・ロック中は描画・操作を受け付けない
    // ピンチ中、または既に他の指が1本指ジェスチャーを進行させている間は、
    // 2本目以降の指をここでは扱わない——ピンチの検知・開始はキャンバスの
    // 外側も含めてonGlobalPointerDownがwindowレベルで一括して行う。
    if (this.state.mode === "pinching" || this.activePointerId !== null) return;
    // 指がキャンバス外に多少はみ出してもmove/upを確実に拾えるようにする
    // （pointerdown/moveはcanvas要素、pointerup/cancelはwindowという非対称な
    // 登録なので、captureで一本化しておく）。
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ブラウザ差異等でcaptureに失敗しても致命的ではないため無視する。
    }
    this.activePointerId = ev.pointerId;

    if (this.textEditor) return; // テキスト入力中は他の操作を受け付けない（blurで確定してから）
    const p = this.toNormalized(ev.clientX, ev.clientY);

    const tool = this.getToolState().tool;

    if (tool === "eraser") {
      this.state.mode = "erasing";
      this.state.lastPoint = p;
      this.store.eraseAt(p, this.getToolState().eraserRadius / this.effectiveScale());
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
        this.state.rotateAnchor = p;
        this.state.rotateAccumRad = 0;
        this.state.rotateFiredSteps = 0;
        this.state.rotateStreak = 0;
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

  /** ページのどこにタッチしても（キャンバス要素の外側でも）2本目の指を検知
   *  できるよう、windowレベルですべてのpointerdownを監視する。今表示中の
   *  インタラクティブなキャンバスだけが反応する——非表示のタブ・
   *  interactive:falseのプレースホルダーは無視する（ユーザー指示：
   *  「どこを2本指でしてもキャンバスのみをズームしたい」）。
   *
   *  2本目の指が乗った瞬間にev.preventDefault()する——style.cssのtouch-action
   *  だけでは、iOS Safariでヘッダー/ツールバー（position:fixedの帯）の上だと
   *  純正のピンチズームが発動してしまう不具合があった（ユーザー報告）。
   *  canvas自身の単指描画（onPointerDown）は最初からpreventDefault()で
   *  純正ジェスチャーを止めており実際に機能しているため、同じ考え方を
   *  2本指検知にも適用する——1本目だけの間は呼ばない（通常のタップ・
   *  ボタン操作を妨げないため）。
   *
   *  ピンチズーム自体（beginPinch）は「選択」道具（move）を選んでいる時だけ
   *  始める——ペン・マーカー・消しゴム・なぞる・テキストの間に指が2本乗っても
   *  （誤って触れた・手のひらが触れた等）、進行中の描画等を中断してズームに
   *  切り替えてしまうのはユーザーにとって意図しない挙動のため（ユーザー指示）。
   *  ただしpreventDefault自体は道具に関わらず呼ぶ——ここで止めないと、
   *  ズームは始めなくてもSafari等の純正ピンチズームがページ全体に効いてしまう。 */
  private onGlobalPointerDown = (ev: PointerEvent): void => {
    if (!this.interactive || this.rewindAt !== null) return;
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視
    this.pinchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinchPointers.size === 2) {
      ev.preventDefault();
      if (this.getToolState().tool === "move") {
        this.beginPinch();
      }
    }
    // 3本目以降はそのまま追跡だけしておく（既存のピンチの起点は変えない）。
  };

  /** ピンチ対象として追跡中の指が動くたびに呼ぶ（windowレベル）。ピンチ中は
   *  引き続きev.preventDefault()し続ける——2本目のpointerdownだけを止めても、
   *  その後の移動でSafariの純正ジェスチャーが再度乗っ取ってくることがあるため
   *  （onGlobalPointerDownのコメント参照）。 */
  private onGlobalPointerMove = (ev: PointerEvent): void => {
    if (!this.pinchPointers.has(ev.pointerId)) return;
    this.pinchPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.state.mode === "pinching") {
      ev.preventDefault();
      this.updatePinch();
    }
  };

  /** ピンチ対象として追跡中の指が離れるたびに呼ぶ（windowレベル）。 */
  private onGlobalPointerUp = (ev: PointerEvent): void => {
    if (!this.pinchPointers.delete(ev.pointerId)) return;
    if (this.state.mode === "pinching" && this.pinchPointers.size < 2) {
      // 1本の指を離しただけでは描画を再開しない——残り1本になったら
      // いったんidleに戻し、新しいpointerdownから仕切り直す。
      this.state.mode = "idle";
      this.pinch = null;
    }
  };

  /** 2本目の指が乗った瞬間に呼ぶ。進行中の1本指ジェスチャー（描画・消しゴム・
   *  なぞる・移動）があれば打ち切ってからピンチの起点を記録する。 */
  private beginPinch(): void {
    if (this.state.mode !== "idle" && this.state.mode !== "pinching") {
      this.endSinglePointerGesture();
    }
    this.activePointerId = null; // 1本指ジェスチャーはピンチに譲る
    const [a, b] = [...this.pinchPointers.values()];
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
    if (!this.pinch || this.pinchPointers.size < 2) return;
    const [a, b] = [...this.pinchPointers.values()];
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

  /** フレームが完全に画面外へ出てしまわないよう、パン量をズーム倍率に応じた範囲に
   *  収める（ズームしていないときはパン自体を許可しない）。フレーム形状の水平/
   *  垂直到達距離（shape.horizontalReach、垂直は常に1正規化単位）でパン量を
   *  正規化してからクランプする——円形クランプのまま（frame.scaleのみ基準）だと、
   *  oval（横長楕円）やglasses（共有キャンバス、横長矩形）のように縦横の到達距離が
   *  異なる形状で、縦基準の狭い円の範囲にパンが制限されてしまう。round/square
   *  （縦横の到達距離が等しい）では結果的に同じ挙動になる。
   *
   *  クランプを完全に撤廃したところ、ズーム＋パンでフレームの縁（曲線の境界）が
   *  画面外まで遠く離れてしまい、円の内側の平らな部分しか見えず正方形の紙にしか
   *  見えなくなる不具合が発生したため復活させた（ユーザー報告・実機で再現確認）。 */
  private clampPan(pan: Point): Point {
    const shape = this.frame.currentShape();
    const maxOffsetX = this.frame.scale * shape.horizontalReach * (this.viewZoom - 1);
    const maxOffsetY = this.frame.scale * (this.viewZoom - 1);
    if (maxOffsetX <= 0 || maxOffsetY <= 0) return { x: 0, y: 0 };
    const nx = pan.x / maxOffsetX;
    const ny = pan.y / maxOffsetY;
    const mag = Math.hypot(nx, ny);
    if (mag <= 1) return pan;
    const k = 1 / mag;
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
    this.state.rotateAnchor = null;
    this.state.rotateAccumRad = 0;
    this.state.rotateFiredSteps = 0;
    this.state.rotateStreak = 0;
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
   * focus()は必ず、呼び出し元のポインタ・キー入力イベントと同じ同期的な呼び出し
   * スタックの中で行う（後述のfocusEl、rAFやsetTimeout等を挟まない）。理由は2つ：
   * ①モバイル（特にiOS Safari系）はユーザー操作のイベントハンドラ内で同期的に
   * focus()しないとソフトウェアキーボードが開かない制約があり、1フレーム遅らせると
   * タップ1回では入力を始められず、2回目のタップでtextarea自体に触れて初めて
   * 開くようになってしまっていた（ユーザー報告・実機で再現確認）。②キーボードから
   * 始めた場合（onGlobalKeyDown）は、フォーカスが遅れるとその間に発生した後続の
   * キー入力（特に日本語IME変換中の2文字目以降）がこのtextareaではなく元の
   * フォーカス先（たいていdocument.body）に向かってしまい、変換途中の文章が
   * 複数のマスに分裂して書き込まれてしまう不具合があった（別途ユーザー報告・
   * 実機で再現確認）。
   */
  private openTextEditor(anchor: Point, editingMemo: TextMemo | null = null, initialText?: string): void {
    if (this.textEditor) return;
    const { color: toolColor, fontSize: toolFontSize } = this.getToolState();
    const color = editingMemo?.color ?? toolColor;
    const fontSize = editingMemo?.fontSize ?? toolFontSize;
    const align = editingMemo?.align ?? "center";
    const lineHeight = editingMemo?.lineHeight ?? LINE_HEIGHT_MULTIPLIER;
    const scaleAtOpen = this.effectiveScale();
    const fontPx = fontPxForRender(fontSize, scaleAtOpen);

    const el = document.createElement("textarea");
    el.className = "text-editor-overlay";
    el.rows = 1;
    el.placeholder = "書き込む...";
    el.value = editingMemo?.text ?? initialText ?? "";
    el.style.color = color;
    el.style.fontFamily = TEXT_FONT_FAMILY;
    // iOS Safari系は、フォーカスした入力欄のfont-sizeが16px未満だと「読みやすく
    // するため」勝手にページ全体をズームインする——これがタップ直後に画面が
    // アップになり、かつそのズームでvisualViewportが動いた拍子にオーバーレイの
    // 位置計算まで狂う（タップ位置と無関係な場所に出る）原因になっていた
    // （ユーザー報告・実機で再現確認）。モバイルでは実際のfontPx（基準文字サイズ
    // ×実効スケール）が16pxを大きく下回るため常に発火していた。表示上の
    // font-sizeだけ16px以上に底上げしてズームそのものを起こさせないようにする
    // ——確定後にメモとして保存される文字サイズ・折り返し幅はcanvas側の計測
    // （fontSize・measureTextBoxWidthPx、共にこのDOM要素のstyleとは独立）で
    // 決まるため、ここでの底上げは編集中の見た目だけに影響し、確定後の見た目には
    // 影響しない。
    const displayFontPx = Math.max(fontPx, 16);
    el.style.fontSize = `${displayFontPx}px`;
    el.style.lineHeight = `${lineHeight}`;
    el.style.textAlign = align;
    // resizeToContent内の幅測定(measureTextBoxWidthPx)にfontSizeをそのまま渡すと、
    // 上の底上げが効くケース（scaleAtOpenがREFERENCE_RADIUSより小さい典型的な
    // モバイル画面）で、実際にdisplayFontPxで描画される文字より狭い幅で計算されて
    // しまい、1行に収まるはずの文章が編集中だけtextarea内で折り返される／はみ出して
    // 見える不具合になる（PRレビュー指摘）。measureTextBoxWidthPxは基準円スケールの
    // 値を受け取りresizeToContent側で実際のscaleを掛けて画面px化する仕組みのため、
    // displayFontPx（画面px）をその逆変換で基準円スケール相当に戻した値を使うことで、
    // 編集中の幅計算と実際の描画フォントサイズを一致させる。
    const widthMeasureFontSize = Math.max(fontSize, (displayFontPx * REFERENCE_RADIUS) / scaleAtOpen);
    document.body.appendChild(el);
    this.textEditor = el;

    // モバイルでtextareaにフォーカスすると、ブラウザが「フォーカスした要素が画面内に
    // 収まるように」ページ全体を自動でスクロールすることがある。このtextareaは
    // position:fixedで自前で画面上の位置を計算しているため、ブラウザのその自動
    // スクロールは不要などころか、resizeToContentがcanvas要素のgetBoundingClientRect()
    // を毎回計算し直す実装のため、ページがスクロールした分だけ位置計算も引きずられて
    // 動いてしまい、タップした位置と無関係な場所に表示される・スクロールにつれて
    // 動いて見えるという不具合の原因になっていた（ユーザー報告・実機で再現確認）。
    // 編集中はhtml/bodyのスクロールを封じてしまい、ブラウザにこの自動スクロールを
    // そもそも起こさせないようにする（commit/キャンセル時に元の値へ戻す）。
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    this.restoreBodyScroll = () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      this.restoreBodyScroll = null;
    };

    // 内容の実際の幅・高さに合わせてtextareaのサイズと位置を更新する（可変幅——
    // ユーザー指示：短い一言でも余白だらけの箱にならないよう、逆に長めの文でも
    // すぐ折り返さないよう、打った内容に応じて幅を変える）。アンカー点
    // (screenX, screenY)は毎回、その時点のcanvasRect/frame.centerPx/viewPan/
    // scaleから計算し直す——1回だけ計算してクロージャに固定していると、
    // モバイルでキーボードが開いてcontainerのサイズが変わりframeが動いた後も
    // 古い位置のまま取り残されてしまう（ユーザー指摘：タップ位置から離れた所に
    // 表示される）。呼び出し元（入力のたびとResizeObserver）の両方から同じ
    // 関数を呼び直すことで、常に今のフレームに対して正しい位置に揃える。
    //
    // visualViewport.offsetLeft/offsetTopの補正について：モバイルでキーボードを
    // 開く際、ブラウザは「フォーカスした要素をキーボードの上に収める」ため
    // ビジュアルビューポート（実際に画面に見えている範囲）だけをページ内で
    // 上下にパンすることがある（レイアウトビューポート自体は動かない）。
    // getBoundingClientRect()はレイアウトビューポート基準の値を返すのに対し、
    // position:fixedもレイアウトビューポート基準で配置されるので一見食い違いは
    // 無さそうだが、実際にはこのパンの分だけ画面上の見た目とズレる
    // （タップ位置が下の方＝パン量が大きいほど、入力欄が上へ大きく飛び出して
    // 見える。ユーザー報告・実機で再現確認：下半分をタップすると画面外まで
    // 飛ぶが上半分は少しのズレで済む＝パン量の違いと一致）。
    // window.visualViewport.offsetLeft/offsetTopはこのパン量そのものなので、
    // 加算して補正する（MDN/web.devで案内されている標準的な対処）。
    const resizeToContent = () => {
      const canvasRect = this.canvas.getBoundingClientRect();
      const scale = this.effectiveScale();
      const viewportOffsetX = window.visualViewport?.offsetLeft ?? 0;
      const viewportOffsetY = window.visualViewport?.offsetTop ?? 0;
      const toScreenPx = (referencePx: number) => (referencePx / REFERENCE_RADIUS) * scale;
      const screenX = canvasRect.left + this.frame.centerPx.x + this.viewPan.x + anchor.x * scale + viewportOffsetX;
      const screenY = canvasRect.top + this.frame.centerPx.y + this.viewPan.y + anchor.y * scale + viewportOffsetY;

      const boxWidthPx = toScreenPx(measureTextBoxWidthPx(this.ctx, el.value, widthMeasureFontSize));
      el.style.width = `${boxWidthPx}px`;
      el.style.left = `${screenX - boxWidthPx / 2}px`;
      el.style.height = "auto";
      const h = el.scrollHeight;
      el.style.height = `${h}px`;
      el.style.top = `${screenY - h / 2}px`;
    };
    resizeToContent();
    el.addEventListener("input", resizeToContent);
    this.repositionTextEditor = resizeToContent;

    // 呼び出し元のイベントハンドラと同じ同期的な呼び出しスタックの中でfocusする
    // （クラス冒頭のJSDoc参照）。
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length); // 編集時・初期文字入り時はカーソルを末尾に

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
      this.repositionTextEditor = null;
      this.restoreBodyScroll?.();
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
    // activePointerIdがnullの間（マウスホバー等、まだ何もつかんでいない）は無視せず
    // 通常通り処理する——1本指ジェスチャー中に限り、それ以外の指の動きを無視する
    // （ピンチ中はbeginPinch()がactivePointerIdをnullに戻すため、ここには来ない）。
    if (this.activePointerId !== null && ev.pointerId !== this.activePointerId) return;

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
      this.updateRotationGesture(this.state.movingMemoId, this.state.lastPoint, p);
      const dx = p.x - this.state.lastPoint.x;
      const dy = p.y - this.state.lastPoint.y;
      this.store.translateMemo(this.state.movingMemoId, dx, dy, this.frame.currentShape().clamp);
      this.state.lastPoint = p;
    } else if (this.state.mode === "erasing") {
      this.state.lastPoint = p;
      this.store.eraseAt(p, this.getToolState().eraserRadius / this.effectiveScale());
    }
  };

  /**
   * 選択道具でメモを掴んで振り回す操作: 掴んだ瞬間の座標（rotateAnchor、固定）を
   * 軸に、prev→curの符号付き回転角を積算する。半径がROTATE_MIN_RADIUS_PX未満の
   * 間は、なぞっている最中の小さな手ブレでも角度が暴れる（原点に近いほど僅かな
   * 位置ズレが大きな角度差になる）ため積算しない。
   * 積算角（rotateAccumRad）を1回転（ROTATE_STEP_RAD）単位の「段」に換算し
   * （rotateFiredSteps）、前回との差分ぶんだけnudgeMemoClockでlastTracedAtを
   * 動かす——時計回りは過去側（進める）、反時計回りは「今」に近い側（復活）。
   * 1段あたりの時間量は固定ではなく、同じ向きに連続で振り回すほど
   * rotateStreak（連続段数）が積み上がりrotateStepAmountMsで加速する
   * （ユーザー指示：連続で回されたら段々加速するように）。向きを変えた
   * 瞬間はstreakを1へ振り直し、その新しい向きでまた1段目から加速し直す
   * ——「逆に回せば減速して戻る」という直感的な操作感になる。
   * クールタイムや1ジェスチャー1回という制限は設けないため、振り回している
   * 間は自由に時間を行き来できる。
   */
  private updateRotationGesture(memoId: string, prev: Point, cur: Point): void {
    if (!this.state.rotateAnchor) return;
    const anchor = this.state.rotateAnchor;
    const prevVec = { x: prev.x - anchor.x, y: prev.y - anchor.y };
    const curVec = { x: cur.x - anchor.x, y: cur.y - anchor.y };
    const minRadius = this.rotateMinRadiusPx / this.effectiveScale();
    if (Math.hypot(prevVec.x, prevVec.y) < minRadius || Math.hypot(curVec.x, curVec.y) < minRadius) return;

    let delta = Math.atan2(curVec.y, curVec.x) - Math.atan2(prevVec.y, prevVec.x);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta <= -Math.PI) delta += Math.PI * 2;
    this.state.rotateAccumRad += delta;

    const targetSteps = Math.trunc(this.state.rotateAccumRad / this.rotateStepRad);
    while (this.state.rotateFiredSteps < targetSteps) {
      this.state.rotateStreak = this.state.rotateStreak > 0 ? this.state.rotateStreak + 1 : 1;
      if (this.rotationVoteHandler) {
        this.rotationVoteHandler(memoId); // 投票フェーズ: 方向・連続回数を問わず熱量+1
      } else {
        this.store.nudgeMemoClock(memoId, -rotateStepAmountMs(this.state.rotateStreak)); // 時計回りに1回転進むごと: 寿命を進める
      }
      this.state.rotateFiredSteps++;
    }
    while (this.state.rotateFiredSteps > targetSteps) {
      this.state.rotateStreak = this.state.rotateStreak < 0 ? this.state.rotateStreak - 1 : -1;
      if (this.rotationVoteHandler) {
        this.rotationVoteHandler(memoId); // 投票フェーズ: 方向・連続回数を問わず熱量+1
      } else {
        this.store.nudgeMemoClock(memoId, rotateStepAmountMs(-this.state.rotateStreak)); // 反時計回りに1回転戻るごと: 復活
      }
      this.state.rotateFiredSteps--;
    }
  }

  /** 何も操作していない間（mode==="idle"）だけ呼ばれる。マウスが「なぞる」「移動」
   *  道具でメモの上に来たら、実際に触れなくても残り時間・回復できる時間の案内を
   *  出せるようにする（ユーザー指示：PCに限りホバーでも見られるように）。
   *  消しゴムでは同じ理由で、当たり範囲のプレビュー円（eraserHoverPoint）を更新する
   *  ——クリックして実際に消し始めるまで大きさが分からない問題の解消（ユーザー指示）。
   *  どちらもタッチには「押さずに触れる」状態が無いため、pointerType==="mouse"の
   *  ときだけ働く——タッチ側は従来どおり実際に触れて操作を始めたときに表示する。 */
  private updateHoverInfo(ev: PointerEvent): void {
    const tool = this.getToolState().tool;
    const isMouse = ev.pointerType === "mouse" && this.rewindAt === null;

    this.eraserHoverPoint = isMouse && tool === "eraser" ? this.toNormalized(ev.clientX, ev.clientY) : null;

    if (!isMouse || (tool !== "trace" && tool !== "move")) {
      this.hoverInfoMemoId = null;
      this.hoverInfoPoint = null;
      return;
    }
    const p = this.toNormalized(ev.clientX, ev.clientY);
    const hitMemo = this.hitTestMemo(p);
    this.hoverInfoMemoId = hitMemo?.id ?? null;
    this.hoverInfoPoint = hitMemo ? p : null;
  }

  /** マウスがキャンバスの外に出たら、ホバー案内・消しゴムのプレビュー円も消す
   *  （出しっぱなしにならないように）。 */
  private onPointerLeave = (): void => {
    this.hoverInfoMemoId = null;
    this.hoverInfoPoint = null;
    this.eraserHoverPoint = null;
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointerId) return; // ピンチ中の指、または元々無関係な指
    this.activePointerId = null;
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
  /** iOS Safariはソフトキーボードが開いてもcontainerのCSS上のサイズ自体は
   *  変えず、代わりに実際に見えている範囲（visual viewport）だけを縮める
   *  ——このケースはResizeObserver（containerのサイズ監視）では捉えられない
   *  ため、window.visualViewportのresize/scrollも別途見て、開いている
   *  text-editor-overlayを再配置する（ユーザー指摘：タップ位置から離れた所に
   *  表示される）。 */
  private onVisualViewportChange = (): void => {
    this.repositionTextEditor?.();
  };

  private onGlobalKeyDown = (ev: KeyboardEvent): void => {
    if (this.rewindAt !== null || this.locked || this.textEditor || this.state.mode !== "idle") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key.length !== 1) return; // 矢印・Enter・Tab等の非文字キーは無視
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement | null)?.isContentEditable) {
      return;
    }
    if (this.canvas.offsetParent === null) return; // 今表示中のタブのキャンバスでなければ無視
    ev.preventDefault();
    this.openTextEditor({ x: 0, y: 0 }, null, ev.key);
  };

  /**
   * 「残り時間」表示（main.ts/smuiView.tsが持つ、ツールバー直上のピル）用。
   * なぞる/移動で実際に触れている、またはPCでホバーしている対象の残り時間
   * (ms)を返す。対象が無ければnull——呼び出し側はnullでピルを隠す。
   */
  getHoverRemainingMs(now: number = Date.now()): number | null {
    const target = currentReviveInfoTarget(this.state, this.hoverInfoMemoId, this.hoverInfoPoint);
    if (!target) return null;
    return this.store.reviveStatusOf(target.memoId, now)?.remainingMs ?? null;
  }

  /** フィット(1倍)より拡大しているか。main.tsがヘッダー/ツールバー（画面全体に
   *  広がったキャンバスの上に固定オーバーレイとして乗る）を薄くするかどうかの
   *  判定に使う（ユーザー指示：ズーム中は下の絵が見えるよう薄くしたい）。 */
  isZoomed(): boolean {
    return this.viewZoom > MIN_ZOOM;
  }

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
    // 投票フェーズ中に積み上がった熱量を相対密度に変換するための基準値。
    // fadeExempt済み(既に確定済み)のメモは母集団から除く——バックエンドの
    // endSession()と同じ考え方（多重セッションで確定済み密度を歪めないため）。
    const maxHeat = Math.max(1, ...memosToRender.filter((m) => !m.fadeExempt).map((m) => m.heat ?? 0));
    for (const memo of memosToRender) {
      // 投票フェーズで確定した(fadeExempt)メモは、遡り表示中であっても常に確定した
      // 濃さのまま——時間経過フェードから恒久的に外れているという仕様のため。
      const opacity = memo.fadeExempt
        ? memo.frozenDensity ?? 1
        : rewindAt !== null
          ? opacityAtTime(memo.traceHistory, memo.lifespanDays, rewindAt)
          : this.store.opacityOf(memo, now);
      if (opacity === null || opacity <= 0) continue;
      const relativeDensity = memo.fadeExempt ? (memo.frozenDensity ?? 0) : (memo.heat ?? 0) / maxHeat;
      if (relativeDensity > 0) renderHeatGlow(ctx, memo, r, relativeDensity);
      renderMemoAt(ctx, memo, r, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    // なぞっている最中・移動中のかすかなグロー
    if ((this.state.mode === "tracing" || this.state.mode === "moving") && this.state.lastPoint) {
      drawRadialGlow(ctx, this.state.lastPoint.x * r, this.state.lastPoint.y * r, 22, TRACE_GLOW);
    }


    // 消しゴムの当たり範囲を示すカーソル。実際に消している最中はstate.lastPoint、
    // それ以外（マウスでホバーしているだけ）はeraserHoverPointを使う——クリックして
    // 実際に消し始めるまで大きさが分からない問題を解消するため（ユーザー指示）。
    const eraserCursorPoint = this.state.mode === "erasing" ? this.state.lastPoint : this.eraserHoverPoint;
    if (eraserCursorPoint) {
      const p = { x: eraserCursorPoint.x * r, y: eraserCursorPoint.y * r };
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.getToolState().eraserRadius, 0, Math.PI * 2);
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
      window.removeEventListener("pointerdown", this.onGlobalPointerDown);
      window.removeEventListener("pointermove", this.onGlobalPointerMove);
      window.removeEventListener("pointerup", this.onGlobalPointerUp);
      window.removeEventListener("pointercancel", this.onGlobalPointerUp);
      window.visualViewport?.removeEventListener("resize", this.onVisualViewportChange);
      window.visualViewport?.removeEventListener("scroll", this.onVisualViewportChange);
    }
    this.textEditor?.remove();
    this.restoreBodyScroll?.();
    this.emptyStateEl?.remove();
    this.container.classList.remove("canvas-host");
    this.canvas.remove();
  }
}
