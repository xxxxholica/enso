import { CircularCanvas } from "./canvasView";
import type { CircularCanvasOptions, ToolState } from "./canvasView";
import { computeAutoScale, computeOuterReach, computeSquareSize, MAX_CANVAS_SIZE } from "./canvasSizing";
import { getFrameShape, MAX_SHAPE_REACH } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { MemoStore } from "./memoStore";
import { getSharedCanvas } from "./sharedCanvas";
import { SharedRoomSync } from "./sharedCanvasSync";
import type { TemplateId } from "./templates";

/** レンズの縁取り・ブリッジ（レンズ間の接続部）で共通して使う「フレームの素材」の
 *  色と太さ。両方から同じ値を参照することで、切れ目なく同じ枠のように見える。 */
export const SMUI_FRAME_COLOR = "oklch(30% 0.02 55)";
export const SMUI_FRAME_WEIGHT_PX = 12;

/** style.cssの `@media (max-width: 700px)` と対になる、横並びレイアウトが
 *  有効な条件。この条件を満たす間だけ、syncLensBoxWidthsがレンズの箱幅を
 *  JSで明示的に設定する（縦積み時はCSSのwidth:100%に委ねるため、明示指定を
 *  外す——smuiView.ts参照）。 */
const DESKTOP_LAYOUT_QUERY = "(min-width: 701px)";

/**
 * SMUI（鯖江メガネUI）: 眼鏡フレーム内に個人キャンバス（左レンズ）と共有キャンバス
 * （右レンズ）を並列配置するデュアルビュー。旧「共有」タブ（SharedCanvasView）を
 * 置き換える。
 *
 * 左レンズは既存のメイン個人MemoStore（同じインスタンス）をそのまま表示・編集する
 * ——SMUIは個人メモの見た目を変えるビューであって、別データではない。
 * 右レンズは選んだ共有キャンバス（ルーム）のMemoStoreを表示・編集する。この
 * MemoStoreはlocalStorageを一切使わないメモリ限定の永続化（sharedCanvasSync.ts）
 * を使い、真の保存先はサーバー（PUT /shared-canvases/:id）——ローカルの個人メモの
 * localStorage["memos"]と衝突しない。書き込みのデバウンス送信と定期ポーリングに
 * よる他メンバーの変更取り込みはSharedRoomSyncが担う（WebSocketが無いため）。
 *
 * ルームがまだ接続されていない間、右レンズは非対話（interactive: false）の
 * CircularCanvasとして存在し続ける——中身は左レンズと同じ白い罫線の紙のままの
 * 「空のレンズ」で、フレーム形状（丸眼鏡/楕円/長方形）は左レンズと全く同じ
 * setFrameShape()呼び出しでリアルタイムに同期される（ユーザー指示：接続前から
 * 形が同期されているようにしたい）。ルームに接続する（selectRoom）と、この
 * 非対話インスタンスを実際のルームのMemoStoreを持つ対話可能なインスタンスに
 * 差し替える。
 *
 * ルームの作成・選択・招待リンクのUIはこのクラスの外（ヘッダーの
 * SharedRoomMenu、main.ts参照）が持つ。このクラスはselectRoom(id)を呼ばれたら
 * そのルームのキャンバスを読み込んで右レンズに表示するだけ。フレーム形状の
 * 選択も同様に外（操作パネルのFrameShapeSelector）が持ち、setFrameShape(id)を
 * 呼ばれたら両レンズに適用するだけ。
 */
export class SmuiView {
  private getToolState: () => ToolState;
  private frameShapeId: FrameShapeId;

  private frameEl!: HTMLElement;
  private bridgeEl!: HTMLElement;
  private leftLensEl!: HTMLElement;
  private rightLensEl!: HTMLElement;
  private leftWrapEl!: HTMLElement;
  private rightWrap!: HTMLElement;
  private rightCanvasContainer!: HTMLElement;
  private rightStatusEl!: HTMLElement;
  private rightLabelEl!: HTMLElement;
  private bridgeTrackEl!: HTMLElement;
  private bridgeBarEl!: HTMLElement;

  private leftLens: CircularCanvas;
  private rightLens: CircularCanvas;
  private roomSync: SharedRoomSync | null = null;

  private active = false;
  private selectedId: string | null = null;

  constructor(
    container: HTMLElement,
    personalStore: MemoStore,
    getToolState: () => ToolState,
    initialFrameShapeId: FrameShapeId
  ) {
    this.getToolState = getToolState;
    this.frameShapeId = initialFrameShapeId;

    this.buildDom(container);

    this.leftLens = new CircularCanvas(this.leftWrapEl, personalStore, getToolState, this.lensOptions());
    this.rightLens = this.buildPlaceholderRightLens();
    this.setRightStatus("右上のメニューからルームを作成・参加してください");

    // ブリッジの実際の位置・幅は、両レンズの縁の実測値に合わせてJSで計算する
    // （CSSだけでは、レンズの太さ・大きさに応じて変わる縁の位置に正確に届かない
    // ——ユーザー指摘の「レンズ同士が接続されて見えない」問題への対応）。
    //
    // frameEl（.smui-frame、常にwidth:100%でJSに一切左右されない）を監視の
    // 起点に含めることが重要: leftWrapEl/rightWrapの横幅はsyncLensBoxWidths自身が
    // 書き込む値（＝この関数の出力）なので、それだけを監視すると「ウィンドウの
    // 横幅だけが変わり、結果としてまだ書き込まれていない新しい横幅」を検知できず
    // 循環依存で固まってしまう（縦方向の変化はCSSのstretchでwrap自身の高さが
    // 動くため発火するが、横方向はJSが最後に書いた値のまま変化しないため発火
    // しない——「一度サイズを決めたら可変式ではない」「ブリッジが縁につながって
    // いない」の原因）。frameElの横幅は外部要因（パネルの利用可能幅）に純粋に
    // 追従する「真の入力」なので、これを監視対象に含めることで取りこぼしなく
    // 再計算できる。
    const bridgeResizeObserver = new ResizeObserver(() => this.syncLayout());
    bridgeResizeObserver.observe(this.frameEl);
    bridgeResizeObserver.observe(this.leftWrapEl);
    bridgeResizeObserver.observe(this.rightWrap);
    this.syncLayout();
  }

  /** 両レンズ（左レンズ・右レンズのプレースホルダー/実体）に共通するCircularCanvas
   *  オプション。3箇所すべてで同じ組み合わせを渡すための単一の置き場所——
   *  contentScaleFactorは、今選んでいる形状に関わらず常にMAX_SHAPE_REACH
   *  （3形状のうち最も余白が必要な長方形の角）を基準に動的計算する。形状ごとに
   *  最適化すると、丸眼鏡・楕円だけ大きくなり長方形だけ小さいままになって、
   *  切り替えるたびにレンズの大きさ（とブリッジの長さ）が変わってしまうため
   *  （ユーザー指摘）。通常キャンバス（main.ts）はこのオプションを渡さず、
   *  CircularCanvas既定の固定0.43のままにする。 */
  private lensOptions(overrides?: Partial<CircularCanvasOptions>): CircularCanvasOptions {
    return {
      frameShapeId: this.frameShapeId,
      frameStrokeColor: SMUI_FRAME_COLOR,
      frameStrokeWidth: SMUI_FRAME_WEIGHT_PX,
      contentScaleFactor: (size) => computeAutoScale(size, MAX_SHAPE_REACH, SMUI_FRAME_WEIGHT_PX) / size,
      ...overrides,
    };
  }

  /**
   * レンズの箱（.smui-lens）の横幅を、明示的にJSで設定する。
   *
   * 以前は.smui-lensをflex-growさせて横幅を伸ばしていたが、実際に描かれる円は
   * computeSquareSize()でmin(幅,高さ)判定される——通常のブラウザウィンドウは
   * 横長（高さの方が制約になりやすい）ため、箱の横幅だけが際限なく伸びる一方、
   * 中の円は高さ基準の小さいままその箱の中央に取り残され、2つのレンズが
   * 接合部から離れて画面の左右に広がって見えてしまっていた（ユーザー指摘：
   * 「接合部寄せ」が実現できていない）。
   *
   * 単純に「箱の高さと同じ幅にする」だけでは不十分——縦長・正方形に近い
   * ウィンドウでは、高さから逆算した幅が2つ分＋ブリッジ＋隙間の合計で
   * .smui-frameの実際の横幅を超えてしまうことがあり、そうなるとflex-wrapが
   * 効いて縦積みレイアウトに化けてしまう（横に並べる意図が崩れる）。そのため
   * 「箱自身の高さ」と「frameの実際の横幅から、ブリッジ・隙間ぶんを引いて
   * 2等分した幅」の小さい方をレンズの一辺として使う——これなら常に2つの
   * レンズが横並びに収まることを計算上保証できる。
   *
   * 狭い画面（style.cssの@media (max-width:700px)でレンズが縦積みになる幅）
   * では、この計算自体に意味が無い（縦に並ぶので隣のレンズと横方向で詰める
   * 必要が無く、むしろ画面幅いっぱいの正方形にしたい）ため、
   * DESKTOP_LAYOUT_QUERYを満たさない間はインラインwidthを外し、CSSの
   * width:100%（幅基準の正方形）に委ねる。
   */
  private syncLensBoxWidths(): void {
    if (!window.matchMedia(DESKTOP_LAYOUT_QUERY).matches) {
      this.leftLensEl.style.width = "";
      this.rightLensEl.style.width = "";
      return;
    }

    const frameRect = this.frameEl.getBoundingClientRect();
    const bridgeWidth = this.bridgeEl.getBoundingClientRect().width;
    const gapPx = parseFloat(getComputedStyle(this.frameEl).columnGap) || 0;
    // frame幅 = 左レンズ幅 + gap + ブリッジ幅 + gap + 右レンズ幅 になるよう、
    // ブリッジ・隙間ぶんを引いて2等分する。
    const maxWidthToFitSideBySide = (frameRect.width - bridgeWidth - gapPx * 2) / 2;

    const leftHeight = this.leftLensEl.getBoundingClientRect().height;
    const rightHeight = this.rightLensEl.getBoundingClientRect().height;
    // 下限（MIN_CANVAS_SIZE）は設けない——横並びに収まる幅を最優先にする単純な
    // 計算にする（ユーザー指示）。DESKTOP_LAYOUT_QUERYが真になる最小幅
    // （701px）でもmaxWidthToFitSideBySideは200pxを十分上回るため、実務上
    // レンズが不自然に小さくなることはない。
    const clamp = (size: number) => Math.min(MAX_CANVAS_SIZE, size, maxWidthToFitSideBySide);

    if (leftHeight > 0) this.leftLensEl.style.width = `${clamp(leftHeight)}px`;
    if (rightHeight > 0) this.rightLensEl.style.width = `${clamp(rightHeight)}px`;
  }

  /** レンズの箱幅・ブリッジの位置と幅を、この順番でまとめて再計算する
   *  （ブリッジの計算は箱幅が確定した後の実測値に依存するため、順序が重要）。 */
  private syncLayout(): void {
    this.syncLensBoxWidths();
    this.updateBridgeBar();
  }

  /**
   * ブリッジのバー本体を、左レンズの右側の縁と右レンズの左側の縁にちょうど
   * 届く幅・位置に合わせる。両レンズとも「箱(wrap)の中でcanvasが中央寄せされ、
   * canvasの中で内容円がMAX_SHAPE_REACH基準の動的scaleで描かれ、縁取りが
   * その外側にさらにframeStrokeWidthぶんはみ出す」という、CircularCanvas.
   * render()・canvasSizing.computeOuterReachと全く同じ計算をここでも行う。
   * 右レンズは接続の有無に関わらず常に実在のCircularCanvasで、フレーム形状も
   * 左レンズと常に同じなので、左右で同じhorizontalReachを使ってよい。
   *
   * 以前は実測した隙間に上限（90px）を設けて「実物の眼鏡の橋のように短く」
   * 見せていたが、レンズの縁（horizontalReach基準）は箱の一辺（3形状共通の
   * 余白基準であるMAX_SHAPE_REACH、長方形の角基準）よりかなり内側にあるため、
   * 実測の隙間は常にその上限を大きく超えてしまい、バーが両方の縁から離れて
   * 浮いて見えてしまっていた（ユーザー指摘）。見た目の短さより「必ず両方の
   * 縁につながって見える」ことを優先し、上限を設けず実測の隙間そのものを
   * バーの幅にする。
   */
  private updateBridgeBar(): void {
    const trackRect = this.bridgeTrackEl.getBoundingClientRect();
    if (trackRect.width === 0 && trackRect.height === 0) return;

    const horizontalReach = getFrameShape(this.frameShapeId).horizontalReach;
    const leftEdgeX = this.lensOuterEdgeX(this.leftWrapEl, 1, horizontalReach);
    const rightEdgeX = this.lensOuterEdgeX(this.rightWrap, -1, horizontalReach);

    const width = Math.max(0, rightEdgeX - leftEdgeX);
    this.bridgeBarEl.style.left = `${leftEdgeX - trackRect.left}px`;
    this.bridgeBarEl.style.width = `${width}px`;
  }

  /** レンズの箱(wrap)の中央から、内容円+縁取りの外側の端までの画面X座標。
   *  directionは中央からどちら向きに測るか（左レンズの右端なら+1、右レンズの
   *  左端なら-1）。両レンズとも同じ計算式（CircularCanvas.render()と同じ
   *  scale/縁取りの求め方）を使うため、左右で1つのメソッドにまとめてある。 */
  private lensOuterEdgeX(wrapEl: HTMLElement, direction: 1 | -1, horizontalReach: number): number {
    const rect = wrapEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const size = computeSquareSize(wrapEl);
    const scale = computeAutoScale(size, MAX_SHAPE_REACH, SMUI_FRAME_WEIGHT_PX);
    return centerX + direction * computeOuterReach(scale, horizontalReach, SMUI_FRAME_WEIGHT_PX);
  }

  private buildDom(container: HTMLElement): void {
    const view = document.createElement("div");
    view.className = "smui-view";

    this.frameEl = document.createElement("div");
    const frame = this.frameEl;
    frame.className = "smui-frame";
    // ブリッジ・右レンズのプレースホルダー枠が同じ値を参照できるよう、frame自体に
    // CSS変数として持たせる（縁取り・ブリッジ・プレースホルダー枠が同じ1つの
    // フレーム素材に見えるようにするため）。
    frame.style.setProperty("--smui-frame-weight", `${SMUI_FRAME_WEIGHT_PX}px`);
    frame.style.setProperty("--smui-frame-color", SMUI_FRAME_COLOR);

    this.leftLensEl = document.createElement("div");
    this.leftLensEl.className = "smui-lens smui-lens--left";
    const leftLabel = document.createElement("div");
    leftLabel.className = "smui-lens-label";
    leftLabel.textContent = "個人キャンバス";
    this.leftLensEl.appendChild(leftLabel);
    this.leftWrapEl = document.createElement("div");
    this.leftWrapEl.className = "smui-lens-canvas-wrap";
    this.leftLensEl.appendChild(this.leftWrapEl);
    frame.appendChild(this.leftLensEl);

    // ブリッジ（レンズをつなぐ橋）。.smui-lensと同じ「ラベル分のスペーサ＋残りを
    // 中央寄せする器」という構造を鏡写しにすることで、バー本体がレンズの
    // canvas-wrap（＝実際のレンズ円）の垂直中央と正確に揃う——固定pxの目分量に
    // 頼らず、レンズのラベル行の高さがどうであってもズレない。
    this.bridgeEl = document.createElement("div");
    this.bridgeEl.className = "smui-bridge";
    const bridgeLabelSpacer = document.createElement("div");
    bridgeLabelSpacer.className = "smui-bridge-label-spacer";
    this.bridgeEl.appendChild(bridgeLabelSpacer);
    this.bridgeTrackEl = document.createElement("div");
    this.bridgeTrackEl.className = "smui-bridge-track";
    this.bridgeBarEl = document.createElement("div");
    this.bridgeBarEl.className = "smui-bridge-bar";
    this.bridgeTrackEl.appendChild(this.bridgeBarEl);
    this.bridgeEl.appendChild(this.bridgeTrackEl);
    frame.appendChild(this.bridgeEl);

    this.rightLensEl = document.createElement("div");
    this.rightLensEl.className = "smui-lens smui-lens--right";
    this.rightLabelEl = document.createElement("div");
    this.rightLabelEl.className = "smui-lens-label";
    this.rightLabelEl.textContent = "共有キャンバス";
    this.rightLensEl.appendChild(this.rightLabelEl);

    // rightWrap自身はCircularCanvasの入れ物を差し替えても消えない、常設の
    // 位置基準（position:relative、style.cssのsmui-lens-canvas-wrap参照）。
    // 中に「実際にCircularCanvasが入る入れ替え可能な入れ物
    // （rightCanvasContainer）」と「読み込み中・失敗時のメッセージ用の
    // オーバーレイ（rightStatusEl、常に重なって表示できる）」を分けて持たせる。
    this.rightWrap = document.createElement("div");
    this.rightWrap.className = "smui-lens-canvas-wrap";
    this.rightCanvasContainer = document.createElement("div");
    this.rightCanvasContainer.className = "smui-lens-canvas-inner";
    this.rightWrap.appendChild(this.rightCanvasContainer);
    this.rightStatusEl = document.createElement("p");
    this.rightStatusEl.className = "smui-lens-status";
    this.rightStatusEl.hidden = true;
    this.rightWrap.appendChild(this.rightStatusEl);
    this.rightLensEl.appendChild(this.rightWrap);
    frame.appendChild(this.rightLensEl);

    view.appendChild(frame);
    container.appendChild(view);
  }

  private setRightStatus(message: string): void {
    this.rightStatusEl.textContent = message;
    this.rightStatusEl.hidden = message.length === 0;
  }

  /** ルーム未接続時の右レンズ。データを持たない非対話（interactive: false）の
   *  CircularCanvasとして実装することで、フレーム形状・大きさ・縁取りが実際の
   *  レンズと完全に同じ仕組みで決まる（ブリッジの実測計算・setFrameShapeによる
   *  即時同期もそのまま使い回せる——ユーザー指示：接続前から形が同期されて
   *  いてほしい）。中身は左レンズと同じ白い罫線の紙のまま（メモは常に空）。 */
  private buildPlaceholderRightLens(): CircularCanvas {
    // 差し替え前の右レンズ（プレースホルダーまたは実体）が残したResizeObserver・
    // windowのポインタリスナーを解除してから作り直す——解除せず古い方をそのまま
    // 捨てると、ルームを切り替えるたびにリークする(CircularCanvas.destroy参照)。
    // 初回構築時（コンストラクタからの呼び出し）はまだrightLensが無いため何もしない。
    this.rightLens?.destroy();
    this.rightCanvasContainer.innerHTML = "";
    const inertStore = new MemoStore(undefined, false);
    return new CircularCanvas(
      this.rightCanvasContainer,
      inertStore,
      this.getToolState,
      this.lensOptions({ interactive: false })
    );
  }

  private updateRightLabel(): void {
    this.rightLabelEl.textContent = this.selectedId
      ? `共有キャンバス: ${this.selectedId.slice(0, 8)}`
      : "共有キャンバス";
  }

  /** ヘッダーのSharedRoomMenuで作成・選択されたルームを右レンズに読み込む。 */
  async selectRoom(id: string): Promise<void> {
    this.selectedId = id;
    this.updateRightLabel();

    this.roomSync?.stop();
    this.roomSync = null;
    this.rightLens = this.buildPlaceholderRightLens();
    this.setRightStatus("読み込み中…");
    this.syncLayout();

    try {
      const detail = await getSharedCanvas(id);
      const sync = new SharedRoomSync(id, (memos) => sharedStore.replaceAll(memos));
      const sharedStore = new MemoStore((memos) => sync.schedulePush(memos), false);
      sharedStore.replaceAll(detail.memos);
      sync.markSynced(detail.memos);
      sync.start();
      this.roomSync = sync;
      this.rightLens.destroy();
      this.rightCanvasContainer.innerHTML = "";
      this.rightLens = new CircularCanvas(this.rightCanvasContainer, sharedStore, this.getToolState, this.lensOptions());
      this.setRightStatus("");
    } catch (e) {
      this.setRightStatus(e instanceof Error ? e.message : "取得に失敗しました");
    }
    // 右レンズの中身（プレースホルダー⇔実際のCircularCanvas）が入れ替わっても
    // wrap要素自体の箱の大きさは変わらないため、ResizeObserverだけでは
    // ブリッジの更新が起きない——ここで明示的に再計算する。
    this.syncLayout();
  }

  /** 操作パネルのFrameShapeSelectorで選ばれた形状を両レンズに適用する。
   *  右レンズは接続の有無に関わらず常に実在のCircularCanvasなので、ルーム未接続の
   *  プレースホルダーにも同じように即座に反映される（ユーザー指示）。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeId = id;
    this.leftLens.setFrameShape(id);
    this.rightLens.setFrameShape(id);
    // 形状が変わるとhorizontalReach（縁の張り出し方）も変わるため、サイズが
    // 同じでもブリッジの幅・位置を再計算する必要がある。
    this.syncLayout();
  }

  /** 表示中かどうかにかかわらず呼んでよい。「共有」タブを離れている間はルームの
   *  ポーリングも止める——画面に映らない間、4秒おきのGETを続けても無駄なため。 */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.roomSync?.resumePolling();
    else this.roomSync?.pausePolling();
  }

  closeWritingSessions(): void {
    this.leftLens.closeWritingSession();
    this.rightLens.closeWritingSession();
  }

  finishTextEditingIfOpen(): void {
    this.leftLens.finishTextEditingIfOpen();
    this.rightLens.finishTextEditingIfOpen();
  }

  beginPlacingTemplate(id: TemplateId): void {
    this.leftLens.beginPlacingTemplate(id);
  }

  render(now: number): void {
    if (!this.active) return;
    this.leftLens.render(now);
    this.rightLens.render(now);
  }
}
