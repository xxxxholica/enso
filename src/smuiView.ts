import { CircularCanvas } from "./canvasView";
import type { CircularCanvasOptions, ToolState } from "./canvasView";
import { getSharedCanvas } from "./sharedCanvas";
import { SharedRoomSync } from "./sharedCanvasSync";
import { MemoStore } from "./memoStore";
import { GLASSES_CENTER_OFFSET, GLASSES_HORIZONTAL_REACH_WITH_HINGE } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import type { FramePatternId } from "./framePattern";
import type { TemplateId } from "./templates";

/** 眼鏡フレームの縁取りの色・太さ。通常キャンバスの薄い1px線より太いウェリントン
 *  風の見た目にする。太さはキャンバスの実サイズ（px）に対する比率で持たせる
 *  ——固定pxだと、ウィンドウが小さくなってもフレームの太さだけ変わらず、
 *  レンズに対して相対的に太すぎ/細すぎに見えてしまう（ユーザー指摘）。 */
export const SMUI_FRAME_COLOR = "oklch(30% 0.02 55)";
export const SMUI_FRAME_WEIGHT_RATIO = 0.04;

/** 案内メッセージ（statusEl）の水平位置: キャンバスの実際の横幅に対する割合
 *  （0.5=中央、1.0=右端）。右レンズの中心（原点からGLASSES_CENTER_OFFSET）が
 *  キャンバス全体（原点から左右にGLASSES_HORIZONTAL_REACH_WITH_HINGEずつ）の
 *  どのあたりに来るかを、frameShape.tsの正規化単位の定数だけから計算する
 *  ——実測値ではなく比率なので、レンズスタイル・ウィンドウサイズが変わっても
 *  常に右レンズの中心に合う。 */
const STATUS_X_FRACTION = 0.5 + GLASSES_CENTER_OFFSET / (2 * GLASSES_HORIZONTAL_REACH_WITH_HINGE);

/**
 * SMUI（鯖江メガネUI）: 「共有」タブの画面。旧デュアルレンズ構成（#9）を置き換え、
 * 個人キャンバスを含まない、大きな眼鏡形状1枚だけの共有（コラボ）キャンバスに
 * する——左右レンズ＋ブリッジ（接合部）が1つの連続した描画領域で、単一の
 * CircularCanvas（frameKind: "glasses"）で完結する。個人キャンバスは既存の
 * 「キャンバス」タブでのみ扱う。
 *
 * 選んだ共有キャンバス（ルーム）のMemoStoreを表示・編集する。このMemoStoreは
 * localStorageを一切使わないメモリ限定の永続化（sharedCanvasSync.ts）を使い、
 * 真の保存先はサーバー（PUT /shared-canvases/:id）——ローカルの個人メモの
 * localStorage["memos"]と衝突しない。書き込みのデバウンス送信と定期ポーリングに
 * よる他メンバーの変更取り込みはSharedRoomSyncが担う（WebSocketが無いため）。
 *
 * ルームがまだ接続されていない間は、非対話（interactive: false）のCircularCanvas
 * として存在し続ける——中身は空の白い罫線の紙のままの「空のキャンバス」で、
 * フレーム形状（丸眼鏡/楕円/長方形、レンズスタイルとして）はルーム未接続でも
 * setFrameShape()呼び出しでリアルタイムに反映される。ルームに接続する
 * （selectRoom）と、この非対話インスタンスを実際のルームのMemoStoreを持つ
 * 対話可能なインスタンスに差し替える。
 *
 * ルームの作成・選択・招待リンクのUIはこのクラスの外（ヘッダーのSharedRoomMenu、
 * main.ts参照）が持つ。このクラスはselectRoom(id)を呼ばれたらそのルームの
 * キャンバスを読み込んで表示するだけ。フレーム形状の選択も同様に外（操作パネルの
 * AppearanceSelector）が持ち、setFrameShape(id)を呼ばれたら適用するだけ。
 */
export class SmuiView {
  private getToolState: () => ToolState;
  private frameShapeId: FrameShapeId;
  private framePatternId: FramePatternId;

  private roomMenuSlotEl!: HTMLElement;
  private appearanceSlotEl!: HTMLElement;
  private canvasWrapEl!: HTMLElement;
  private canvasContainerEl!: HTMLElement;
  private statusEl!: HTMLElement;

  private lens: CircularCanvas;
  private roomSync: SharedRoomSync | null = null;
  private statusResizeObserver!: ResizeObserver;
  private onRequestTemplatePicker?: () => void;

  private active = false;

  constructor(
    container: HTMLElement,
    getToolState: () => ToolState,
    initialFrameShapeId: FrameShapeId,
    initialFramePatternId: FramePatternId,
    onRequestTemplatePicker?: () => void
  ) {
    this.getToolState = getToolState;
    this.onRequestTemplatePicker = onRequestTemplatePicker;
    this.frameShapeId = initialFrameShapeId;
    this.framePatternId = initialFramePatternId;

    this.buildDom(container);

    this.lens = this.buildPlaceholderCanvas();

    // canvas要素自体の実際の位置・大きさ（getBoundingClientRect）を基準に
    // メッセージを右レンズの中心へ動的に配置し直す——CSSの%指定だけだと、
    // キャンバスの縦横比がコンテナの縦横比と一致せずキャンバスがラップ要素より
    // 小さくレターボックスされる場合に、ラップ基準の%位置がキャンバス上の
    // 本当のレンズ中心とズレてしまう（極端に横長・低いウィンドウで実際に発生）。
    this.statusResizeObserver = new ResizeObserver(() => this.repositionStatus());
    this.statusResizeObserver.observe(this.canvasWrapEl);
  }

  /** ルーム作成・選択ボタンの器。main.tsがここにSharedRoomMenuをマウントする
   *  （このクラス自身はルーム作成・選択のUIを持たず、置き場所を提供するだけ）。 */
  getRoomMenuSlot(): HTMLElement {
    return this.roomMenuSlotEl;
  }

  /** 「見た目の設定」（フレームの形・色）ボタンの器。ルーム設定ボタンの右隣に
   *  置く（ユーザー指示）。main.tsがここにAppearanceSelectorをマウントする。 */
  getAppearanceSlot(): HTMLElement {
    return this.appearanceSlotEl;
  }

  /** 共有キャンバス（プレースホルダー/実体）に共通するCircularCanvasオプション。 */
  private lensOptions(overrides?: Partial<CircularCanvasOptions>): CircularCanvasOptions {
    return {
      frameShapeId: this.frameShapeId,
      frameKind: "glasses",
      framePatternId: this.framePatternId,
      frameStrokeColor: SMUI_FRAME_COLOR,
      frameStrokeWidth: (canvasSizePx) => canvasSizePx * SMUI_FRAME_WEIGHT_RATIO,
      onRequestTemplatePicker: this.onRequestTemplatePicker,
      ...overrides,
    };
  }

  private buildDom(container: HTMLElement): void {
    const view = document.createElement("div");
    view.className = "smui-view";

    this.canvasWrapEl = document.createElement("div");
    this.canvasWrapEl.className = "smui-canvas-wrap";
    this.canvasContainerEl = document.createElement("div");
    this.canvasContainerEl.className = "smui-canvas-inner";
    this.canvasWrapEl.appendChild(this.canvasContainerEl);
    this.statusEl = document.createElement("p");
    this.statusEl.className = "smui-canvas-status";
    this.statusEl.hidden = true;
    this.canvasWrapEl.appendChild(this.statusEl);
    view.appendChild(this.canvasWrapEl);

    // ルーム作成・選択（SharedRoomMenu）、見た目の設定（AppearanceSelector、
    // フレームの形・色）は、眼鏡キャンバスの下に横並びで置く（ユーザー指示）。
    // main.tsがgetRoomMenuSlot()/getAppearanceSlot()経由でそれぞれの中身を
    // マウントする——このクラス自身はルーム作成・見た目設定のUIを持たず、
    // 置き場所を提供するだけ。
    const roomMenuRow = document.createElement("div");
    roomMenuRow.className = "smui-room-menu-row";
    this.roomMenuSlotEl = document.createElement("div");
    roomMenuRow.appendChild(this.roomMenuSlotEl);
    this.appearanceSlotEl = document.createElement("div");
    roomMenuRow.appendChild(this.appearanceSlotEl);
    view.appendChild(roomMenuRow);

    container.appendChild(view);
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.hidden = message.length === 0;
  }

  /** statusElを、実際に描画されているcanvas要素の右レンズ中心へ動的に配置し直す。
   *  canvas要素はwrap内でflexセンタリングされているだけで、wrap自身と同じ
   *  大きさとは限らない（レターボックスされることがある）ため、wrap基準の%
   *  指定ではなくcanvas自身のgetBoundingClientRectを基準にする。 */
  private repositionStatus(): void {
    const canvas = this.canvasContainerEl.querySelector("canvas");
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;
    const wrapRect = this.canvasWrapEl.getBoundingClientRect();
    const x = canvasRect.left - wrapRect.left + canvasRect.width * STATUS_X_FRACTION;
    const y = canvasRect.top - wrapRect.top + canvasRect.height / 2;
    this.statusEl.style.left = `${x}px`;
    this.statusEl.style.top = `${y}px`;
  }

  /** ルーム未接続時の共有キャンバス。データを持たない非対話（interactive: false）の
   *  CircularCanvasとして実装することで、フレーム形状・大きさ・縁取りが実際の
   *  ルーム接続時と完全に同じ仕組みで決まる。中身は空の白い罫線の紙のまま
   *  （メモは常に空）。 */
  private buildPlaceholderCanvas(): CircularCanvas {
    // 差し替え前のキャンバス（プレースホルダーまたは実体）が残したResizeObserver・
    // windowのポインタリスナーを解除してから作り直す——解除せず古い方をそのまま
    // 捨てると、ルームを切り替えるたびにリークする(CircularCanvas.destroy参照)。
    // 初回構築時（コンストラクタからの呼び出し）はまだlensが無いため何もしない。
    this.lens?.destroy();
    this.canvasContainerEl.innerHTML = "";
    const inertStore = new MemoStore(undefined, false);
    return new CircularCanvas(
      this.canvasContainerEl,
      inertStore,
      this.getToolState,
      this.lensOptions({ interactive: false })
    );
  }

  /** ヘッダーのSharedRoomMenuで作成・選択されたルームを読み込む。 */
  async selectRoom(id: string): Promise<void> {
    this.roomSync?.stop();
    this.roomSync = null;
    this.lens = this.buildPlaceholderCanvas();
    this.setStatus("読み込み中…");

    try {
      const detail = await getSharedCanvas(id);
      const sync = new SharedRoomSync(id, (memos) => sharedStore.replaceAll(memos));
      const sharedStore = new MemoStore((memos) => sync.schedulePush(memos), false);
      sharedStore.replaceAll(detail.memos);
      sync.markSynced(detail.memos);
      sync.start();
      this.roomSync = sync;
      this.lens.destroy();
      this.canvasContainerEl.innerHTML = "";
      this.lens = new CircularCanvas(this.canvasContainerEl, sharedStore, this.getToolState, this.lensOptions());
      this.setStatus("");
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "取得に失敗しました");
    }
  }

  /** 操作パネルのAppearanceSelectorで選ばれた形状（レンズスタイル）を適用する。
   *  ルーム未接続のプレースホルダーにも同じように即座に反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeId = id;
    this.lens.setFrameShape(id);
  }

  /** 操作パネルのAppearanceSelectorで選ばれた柄・質感を適用する。
   *  ルーム未接続のプレースホルダーにも同じように即座に反映される。 */
  setFramePattern(id: FramePatternId): void {
    this.framePatternId = id;
    this.lens.setFramePattern(id);
  }

  /** 表示中かどうかにかかわらず呼んでよい。「共有」タブを離れている間はルームの
   *  ポーリングも止める——画面に映らない間、定期的なGETを続けても無駄なため。 */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.roomSync?.resumePolling();
    else this.roomSync?.pausePolling();
  }

  closeWritingSessions(): void {
    this.lens.closeWritingSession();
  }

  finishTextEditingIfOpen(): void {
    this.lens.finishTextEditingIfOpen();
  }

  beginPlacingTemplate(id: TemplateId): void {
    this.lens.beginPlacingTemplate(id);
  }

  render(now: number): void {
    if (!this.active) return;
    this.lens.render(now);
  }
}
