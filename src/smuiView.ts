import { CircularCanvas } from "./canvasView";
import type { CircularCanvasOptions, ToolState } from "./canvasView";
import {
  addMemoHeat,
  advanceSession,
  endSession as endSessionApi,
  extendSession,
  getSharedCanvas,
  startSession,
  type SessionState,
  type StartSessionOptions,
} from "./sharedCanvas";
import { SharedRoomSync } from "./sharedCanvasSync";
import { MemoStore } from "./memoStore";
import { GLASSES_CENTER_OFFSET, GLASSES_HORIZONTAL_REACH_WITH_HINGE } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import type { FramePatternId } from "./framePattern";
import { ReviveInfoPill } from "./reviveInfoPill";
import { SessionPanel } from "./sessionPanel";
import type { TemplateId } from "./templates";
import { DEFAULT_INK, type Toolbar } from "./toolbar";
import { getCurrentUser } from "./authState";

/** フェーズ①(ideation)の色プール。参加者ごとに割り当てられたcolor_indexから、
 *  黄金角で均等に色相を割り振って生成する——上限人数(maxParticipants)が
 *  何人でも、固定の配列を使い切る心配がなく均等に見分けやすい色になる。 */
function colorForIndex(index: number): string {
  const hue = (index * 137.508) % 360;
  return `oklch(58% 0.15 ${hue.toFixed(1)})`;
}

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
  private reviveInfoPill!: ReviveInfoPill;

  private lens: CircularCanvas;
  private roomSync: SharedRoomSync | null = null;
  private selectedRoomId: string | null = null;
  /** selectRoom()で読み込んだ実体（プレースホルダーでない）のMemoStore。
   *  投票フェーズの熱量をnotifyHeatChanged/handleRotationVoteから直接
   *  書き換えるために保持しておく。 */
  private sharedStore: MemoStore | null = null;
  private toolbar: Toolbar;
  private sessionPanel!: SessionPanel;
  /** ルームの作成者=ルームマスター。セッションの開始・進行操作の可否判定に使う。 */
  private ownerId: string | null = null;
  private session: SessionState | null = null;
  /** selectRoom()の多重呼び出し（招待リンク自動参加と手動クリックが競合する
   *  等）に対するレース対策。呼び出しごとに採番し、awaitから戻った時点で
   *  自分がまだ最新かを確認する——古い方はSharedRoomSyncのsetIntervalを
   *  作らず即座に諦めることで、置き去りのポーリングが残るのを防ぐ。 */
  private roomRequestSeq = 0;
  private statusResizeObserver!: ResizeObserver;
  private onRequestTemplatePicker?: () => void;

  private active = false;

  constructor(
    container: HTMLElement,
    getToolState: () => ToolState,
    initialFrameShapeId: FrameShapeId,
    initialFramePatternId: FramePatternId,
    toolbar: Toolbar,
    onRequestTemplatePicker?: () => void
  ) {
    this.getToolState = getToolState;
    this.onRequestTemplatePicker = onRequestTemplatePicker;
    this.frameShapeId = initialFrameShapeId;
    this.framePatternId = initialFramePatternId;
    this.toolbar = toolbar;

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

  /** 共同アイデア出しセッションのフェーズ①②の間、実際に使われる色を上書きする
   *  （Toolbar自体はいじらず、こちらのラッパーだけが返す値を差し替える——
   *  Toolbarは「キャンバス」タブとも共有する単一インスタンスのため）。 */
  private effectiveToolState = (): ToolState => {
    const base = this.getToolState();
    const forced = this.forcedColor();
    return forced ? { ...base, color: forced } : base;
  };

  private isRoomMaster(): boolean {
    return this.ownerId !== null && getCurrentUser()?.id === this.ownerId;
  }

  /** 今のセッションフェーズに応じて強制すべき色。無ければnull(通常どおり
   *  Toolbarで選んだ色を使う)。 */
  private forcedColor(): string | null {
    if (!this.session) return null;
    if (this.session.phase === "discussion") return this.isRoomMaster() ? DEFAULT_INK : null;
    if (this.session.phase === "ideation") {
      return this.session.myColorIndex !== null ? colorForIndex(this.session.myColorIndex) : null;
    }
    return null;
  }

  /** セッション状態に応じて、道具バーの見た目(色ロック表示・全体の有効/無効)と
   *  実際のキャンバスの書き込み可否(CircularCanvas.setLocked)を揃える。
   *  フェーズ②(議論)はルームマスター以外を完全に読み取り専用にする——
   *  「話し合いの時間」であって、書き込むための時間ではないため。 */
  private applyRestrictions(): void {
    if (!this.active || !this.session) {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(false);
      this.lens.setLocked(false);
      return;
    }
    const isMaster = this.isRoomMaster();
    if (this.session.phase === "discussion") {
      this.toolbar.setEnabled(isMaster);
      this.toolbar.setColorLocked(true);
      this.lens.setLocked(!isMaster);
    } else if (this.session.phase === "ideation") {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(this.session.myColorIndex !== null);
      this.lens.setLocked(false);
    } else {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(false);
      this.lens.setLocked(false);
    }
  }

  /** セッション状態が変わるたびに呼ぶ(selectRoom/session系コールバック/
   *  notifySessionChanged共通)。道具バー・書き込み制限・投票フェーズの
   *  回転ジェスチャーの意味づけをまとめて更新する。 */
  private applySession(session: SessionState | null): void {
    const wasVoting = this.session?.phase === "voting";
    this.session = session;
    this.applyRestrictions();
    this.lens.setRotationVoteHandler(session?.phase === "voting" ? (memoId) => this.handleRotationVote(memoId) : null);
    // votingから抜けた(=セッション終了)ことでサーバー側のendSession()が各メモの
    // fadeExempt/frozenDensityを確定させた直後なので、次のポーリングを待たず
    // すぐ取得し直す——待つと、確定したはずのメモが最大SHARED_POLL_INTERVAL_MSの
    // 間、古いlastTracedAtのままフェードし続けてしまう。
    if (wasVoting && !session) this.roomSync?.pollNow();
  }

  /** フェーズ③(voting)専用: メモを1回転させるたびにcanvasView.tsから呼ばれる。
   *  楽観的にローカルの熱量を+1しておき、サーバーの確定値で追って合わせ直す
   *  （他の参加者の同時加算と多少ズレても、次のheat-changed通知/ポーリングで
   *  自然に収束する）。熱量は単調増加のはずなので、ネットワークの遅延で
   *  レスポンスが前後しても、受け取った値が今の値より小さければ無視する
   *  （古いレスポンスで新しい値を巻き戻さないため）。 */
  private handleRotationVote(memoId: string): void {
    const roomId = this.selectedRoomId;
    const store = this.sharedStore;
    if (!roomId || !store) return;
    const memo = store.getAll().find((m) => m.id === memoId);
    store.setMemoHeat(memoId, (memo?.heat ?? 0) + 1);
    void addMemoHeat(roomId, memoId)
      .then(({ heat }) => {
        const current = store.getAll().find((m) => m.id === memoId)?.heat ?? 0;
        if (heat > current) store.setMemoHeat(memoId, heat);
      })
      .catch((e) => console.error("[smuiView] heat post failed", e));
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
    // 置き場所を提供するだけ。「残り時間」ピルはそれらの横に並べる
    // （ユーザー指示）——このクラス自身がlensの状態を持っているため、
    // 他の2つと違い自分でReviveInfoPillを持ち、render()のたびに更新する。
    const roomMenuRow = document.createElement("div");
    roomMenuRow.className = "info-row";
    this.roomMenuSlotEl = document.createElement("div");
    roomMenuRow.appendChild(this.roomMenuSlotEl);
    this.appearanceSlotEl = document.createElement("div");
    roomMenuRow.appendChild(this.appearanceSlotEl);
    this.reviveInfoPill = new ReviveInfoPill(roomMenuRow);
    this.sessionPanel = new SessionPanel(roomMenuRow, {
      onStart: (options) => this.startSessionForCurrentRoom(options),
      onAdvance: () => this.advanceSessionForCurrentRoom(),
      onExtend: (addMs) => this.extendSessionForCurrentRoom(addMs),
      onEnd: () => this.endSessionForCurrentRoom(),
    });
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
      this.effectiveToolState,
      this.lensOptions({ interactive: false })
    );
  }

  /** ヘッダーのSharedRoomMenuで作成・選択されたルームを読み込む。
   *  main.tsが同時にrealtimeSync.subscribeToRoom(id)も呼び、以後の
   *  WebSocket通知はnotifyRemoteChangeIfCurrent()経由で届く。 */
  async selectRoom(id: string): Promise<void> {
    const mySeq = ++this.roomRequestSeq;
    this.roomSync?.stop();
    this.roomSync = null;
    this.selectedRoomId = id;
    this.sharedStore = null;
    this.sessionPanel.reset();
    this.applySession(null);
    this.ownerId = null;
    this.lens = this.buildPlaceholderCanvas();
    this.setStatus("読み込み中…");

    try {
      const detail = await getSharedCanvas(id);
      // 待っている間に別のselectRoom呼び出しが割り込んでいたら、自分は
      // もう最新ではないので、SharedRoomSyncを作らず（＝ポーリングの
      // setIntervalを残さず）ここで諦める。
      if (mySeq !== this.roomRequestSeq) return;
      const sync = new SharedRoomSync(id, (memos) => sharedStore.replaceAll(memos));
      const sharedStore = new MemoStore((memos) => sync.schedulePush(memos), false);
      sharedStore.replaceAll(detail.memos);
      sync.markSynced(detail.memos);
      sync.start();
      this.roomSync = sync;
      this.sharedStore = sharedStore;
      this.ownerId = detail.ownerId || null;
      this.lens.destroy();
      this.canvasContainerEl.innerHTML = "";
      this.lens = new CircularCanvas(this.canvasContainerEl, sharedStore, this.effectiveToolState, this.lensOptions());
      this.applySession(detail.session); // 新しいlensに書き込み制限・投票ハンドラを適用する
      this.setStatus("");
    } catch (e) {
      if (mySeq !== this.roomRequestSeq) return;
      this.setStatus(e instanceof Error ? e.message : "取得に失敗しました");
    }
  }

  /** realtimeSync.tsが{type:"session-changed", canvasId, session}を受け取る
   *  たびに呼ぶ。メモ内容を伴わないため、GETし直さずこの状態をそのまま適用する。 */
  notifySessionChanged(canvasId: string, session: SessionState | null): void {
    if (this.selectedRoomId === canvasId) this.applySession(session);
  }

  /** realtimeSync.tsが{type:"heat-changed", ...}を受け取るたびに呼ぶ。
   *  フルGETを挟まず、手元のメモの熱量だけをその場で書き換える。 */
  notifyHeatChanged(canvasId: string, memoId: string, heat: number): void {
    if (this.selectedRoomId === canvasId) this.sharedStore?.setMemoHeat(memoId, heat);
  }

  private startSessionForCurrentRoom(options: StartSessionOptions): void {
    const id = this.selectedRoomId;
    if (!id) return;
    void startSession(id, options)
      .then((session) => this.applySession(session))
      .catch((e) => console.error("[smuiView] session start failed", e));
  }

  private advanceSessionForCurrentRoom(): void {
    const id = this.selectedRoomId;
    if (!id) return;
    void advanceSession(id)
      .then((session) => this.applySession(session))
      .catch((e) => console.error("[smuiView] session advance failed", e));
  }

  private extendSessionForCurrentRoom(addMs: number): void {
    const id = this.selectedRoomId;
    if (!id) return;
    void extendSession(id, addMs)
      .then((session) => this.applySession(session))
      .catch((e) => console.error("[smuiView] session extend failed", e));
  }

  private endSessionForCurrentRoom(): void {
    const id = this.selectedRoomId;
    if (!id) return;
    void endSessionApi(id)
      .then(() => this.applySession(null))
      .catch((e) => console.error("[smuiView] session end failed", e));
  }

  /** realtimeSync.tsが{type:"changed", canvasId}を受け取るたびに呼ぶ。
   *  サーバー側に購読解除が無く、過去に見ていた別ルーム分の通知も届き
   *  続けるため、今表示中のルームと一致する時だけ即座に取得し直す。 */
  notifyRemoteChangeIfCurrent(canvasId: string): void {
    if (this.selectedRoomId === canvasId) this.roomSync?.pollNow();
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
    this.applyRestrictions();
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
    this.reviveInfoPill.update(this.lens.getHoverRemainingMs(now));
    this.sessionPanel.update(now, this.isRoomMaster(), this.session);
  }
}
