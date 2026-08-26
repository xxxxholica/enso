import { CircularCanvas } from "./canvasView";
import type { CircularCanvasOptions, ToolState } from "./canvasView";
import {
  addMemoHeat,
  advanceSession,
  endSession as endSessionApi,
  extendSession,
  getSharedCanvas,
  startSession,
  updateSharedAppearance,
  type SessionState,
  type StartSessionOptions,
} from "./sharedCanvas";
import { SharedRoomSync } from "./sharedCanvasSync";
import { MemoStore } from "./memoStore";
import type { Memo } from "./types";
import { GLASSES_CENTER_OFFSET, GLASSES_HORIZONTAL_REACH_WITH_HINGE } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import type { FramePatternId } from "./framePattern";
import { computeLensSplitPairCount, LENS_COUNT } from "./lensSplit";
import { colorForIndex, lensIndexForColor } from "./participantColors";
import { phaseCutInLabel } from "./phaseCutInLabel";
import { showPhaseCutIn } from "./phaseCutIn";
import { ReviveInfoPill } from "./reviveInfoPill";
import { SessionPanel } from "./sessionPanel";
import { loadFramePattern, loadFrameShape } from "./storage";
import { DEFAULT_INK, type Toolbar } from "./toolbar";
import { getCurrentUser } from "./authState";

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
 * 真の保存先はサーバー（メモ単位のPUT/DELETE /shared-canvases/:id/memos/:memoId、
 * issue #99）——ローカルの個人メモのlocalStorage["memos"]と衝突しない。触れた
 * メモ単位の短いデバウンス送信はSharedRoomSyncが担い、他メンバーの変更取り込みは
 * WebSocketで届くメモの中身(notifyMemoUpserted/notifyMemoDeleted)をその場で
 * 反映する形が主経路、名前・見た目の変更や再接続直後のresyncだけSharedRoomSync
 * のpoll(GETでの全件取得し直し)を使う。
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
   *  自分がまだ最新かを確認する——古い方はSharedRoomSyncを作らず即座に
   *  諦めることで、置き去りのインスタンスが残るのを防ぐ。 */
  private roomRequestSeq = 0;
  private statusResizeObserver!: ResizeObserver;

  private active = false;

  constructor(
    container: HTMLElement,
    getToolState: () => ToolState,
    initialFrameShapeId: FrameShapeId,
    initialFramePatternId: FramePatternId,
    toolbar: Toolbar
  ) {
    this.getToolState = getToolState;
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

  /** セッション状態に応じて、道具バーの見た目(色ロック表示・全体の有効/無効・
   *  道具の絞り込み)と実際のキャンバスの書き込み可否(CircularCanvas.setLocked/
   *  setVoteOnly)を揃える。フェーズ②(議論)はルームマスター以外を完全に
   *  読み取り専用にする——「話し合いの時間」であって、書き込むための時間
   *  ではないため。フェーズ③(投票)は「選択」道具で掴んで回す投票ジェスチャー
   *  だけに絞る——主催者を含め全員が対象（issue #79：ユーザー指示）。
   *  setOnlyToolEnabled("move")で道具バー側もそれ以外を実際に押せなく＆
   *  薄くし、setVoteOnlyでキャンバス側も同様に絞る（片方だけだと、道具バー上は
   *  選べないのにキャンバスへの旧来の直接操作は残る、または逆に道具バー上は
   *  選べてしまうのにキャンバスだけ弾く、という食い違いが起きるため両方合わせる）。 */
  private applyRestrictions(): void {
    if (!this.active || !this.session) {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(false);
      this.toolbar.setOnlyToolEnabled(null);
      this.lens.setLocked(false);
      this.lens.setVoteOnly(false);
      this.lens.setLensSplit(null);
      return;
    }
    const isMaster = this.isRoomMaster();
    if (this.session.phase === "discussion") {
      this.toolbar.setEnabled(isMaster);
      this.toolbar.setColorLocked(true);
      this.toolbar.setOnlyToolEnabled(null);
      this.lens.setLocked(!isMaster);
      this.lens.setVoteOnly(false);
      this.lens.setLensSplit(null);
    } else if (this.session.phase === "ideation") {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(this.session.myColorIndex !== null);
      this.toolbar.setOnlyToolEnabled(null);
      // レンズ枚数(LENS_COUNT=4)を超える5人目以降の参加者(色は割り当て済みだが
      // 4以上)は、フェーズ①の間だけ閲覧専用にする（issue #79、ユーザー確認済みの
      // 製品判断）。maxParticipants自体もLENS_COUNTと同じ4が上限のため
      // (sessionPanel.ts MAX_PARTICIPANTS_RANGE)、通常はここに該当しない
      // ——過去に開始した8人上限のセッションが残っている場合の後方互換として
      // 残す。myColorIndexがそもそもnull（色プール自体が枯渇——maxParticipants
      // を超えて参加した場合）は、このレンズ分割とは無関係の既存の別経路なので
      // 従来通り自由に書けるままにする（回帰させない）。
      const myLensIndex =
        this.session.myColorIndex !== null && this.session.myColorIndex < LENS_COUNT ? this.session.myColorIndex : null;
      const isOverflowLensParticipant = this.session.myColorIndex !== null && myLensIndex === null;
      this.lens.setLocked(isOverflowLensParticipant);
      this.lens.setVoteOnly(false);
      this.lens.setLensSplit(
        myLensIndex !== null
          ? {
              myLensIndex,
              lensIndexForMemo: (memo) => lensIndexForColor(memo.color),
              pairCount: computeLensSplitPairCount(this.session.maxParticipants),
            }
          : null
      );
    } else {
      this.toolbar.setEnabled(true);
      this.toolbar.setColorLocked(false);
      this.toolbar.setOnlyToolEnabled("move");
      this.lens.setLocked(false);
      this.lens.setVoteOnly(true);
      this.lens.setLensSplit(null);
    }
  }

  /** セッション状態が変わるたびに呼ぶ(selectRoom/session系コールバック/
   *  notifySessionChanged共通)。道具バー・書き込み制限・投票フェーズの
   *  回転ジェスチャーの意味づけをまとめて更新する。
   *  silent=trueは、ルーム入室時の初期ハイドレート専用——既に進行中の
   *  セッションに途中参加しただけなのに「アイデア出し開始」等のカットインが
   *  出てしまうのを防ぐ（issue #79）。 */
  private applySession(session: SessionState | null, options: { silent?: boolean } = {}): void {
    const prevPhase = this.session?.phase ?? null;
    const wasVoting = prevPhase === "voting";
    this.session = session;
    this.applyRestrictions();
    this.lens.setRotationVoteHandler(session?.phase === "voting" ? (memoId) => this.handleRotationVote(memoId) : null);
    // votingから抜けた(=セッション終了)ことでサーバー側のendSession()が各メモの
    // fadeExempt/frozenDensityを確定させた直後なので、すぐ取得し直す——放置すると
    // 確定したはずのメモが古いlastTracedAtのままフェードし続けてしまう。
    if (wasVoting && !session) this.roomSync?.pollNow(true);
    if (!options.silent) {
      const label = phaseCutInLabel(prevPhase, session);
      if (label) showPhaseCutIn(label);
    }
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
    this.applySession(null, { silent: true });
    this.ownerId = null;
    // 前のルームでルームマスターが設定した見た目を次のルームへ持ち越さない
    // ように、いったんローカルの既定値へ戻す——この後、新しいルームが独自の
    // 値を持っていればapplyRemoteAppearanceで上書きされる。
    this.frameShapeId = loadFrameShape();
    this.framePatternId = loadFramePattern();
    this.lens = this.buildPlaceholderCanvas();
    this.setStatus("読み込み中…");

    try {
      const detail = await getSharedCanvas(id);
      // 待っている間に別のselectRoom呼び出しが割り込んでいたら、自分は
      // もう最新ではないので、SharedRoomSyncを作らずここで諦める。
      if (mySeq !== this.roomRequestSeq) return;
      const sync = new SharedRoomSync(
        id,
        (remoteDetail) => {
          sharedStore.replaceAll(remoteDetail.memos);
          this.applyRemoteAppearance(remoteDetail.frameShapeId, remoteDetail.framePatternId);
        },
        (session) => this.applySession(session)
      );
      const sharedStore = new MemoStore(undefined, false, (op) => sync.pushOp(op));
      sharedStore.replaceAll(detail.memos);
      sync.markSynced(detail);
      this.roomSync = sync;
      this.sharedStore = sharedStore;
      this.ownerId = detail.ownerId || null;
      this.applyRemoteAppearance(detail.frameShapeId, detail.framePatternId);
      this.lens.destroy();
      this.canvasContainerEl.innerHTML = "";
      this.lens = new CircularCanvas(this.canvasContainerEl, sharedStore, this.effectiveToolState, this.lensOptions());
      // 新しいlensに書き込み制限・投票ハンドラを適用する。silent: 進行中の
      // セッションに途中参加しただけでカットインが出るのを防ぐ。
      this.applySession(detail.session, { silent: true });
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

  /** realtimeSync.tsが{type:"memo-upserted", ...}を受け取るたびに呼ぶ(issue #99)。
   *  フルGETを挟まず、届いたメモの中身をその場で反映する。 */
  notifyMemoUpserted(canvasId: string, memo: Memo): void {
    if (this.selectedRoomId === canvasId) this.sharedStore?.applyRemoteUpsert(memo);
  }

  /** 同じく{type:"memo-deleted", ...}を受け取るたびに呼ぶ。 */
  notifyMemoDeleted(canvasId: string, memoId: string): void {
    if (this.selectedRoomId === canvasId) this.sharedStore?.applyRemoteDelete(memoId);
  }

  private startSessionForCurrentRoom(options: StartSessionOptions): void {
    const id = this.selectedRoomId;
    if (!id) return;
    // フェーズ①はレンズ分割表示になり、参加者色と一致しないメモ（セッション開始前に
    // 自由に書かれていたもの等）は一時的に非表示になる（issue #79、ユーザー確認済みの
    // 製品判断）——開始前にルームマスターへ明示しておく。フェーズ②③に進めば
    // 単一ビューに戻り、これらのメモも普通に見えるようになる。
    const confirmed = window.confirm(
      "アイデア出しを開始します。参加者の色と一致しないメモ（事前の下書き等）は、アイデア出し中は一時的に非表示になります。よろしいですか？"
    );
    if (!confirmed) return;
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

  /** realtimeSync.tsのWebSocket再接続直後に呼ぶ。接続中は通知の取りこぼしが
   *  無い前提のため、再接続の瞬間だけ改めて取得し直せば十分（issue #79）。 */
  notifyReconnected(): void {
    this.roomSync?.pollNow();
  }

  /** 操作パネルのAppearanceSelectorで選ばれた形状（レンズスタイル）を適用する。
   *  ルーム未接続のプレースホルダーにも同じように即座に反映される。ルーム
   *  接続中でルームマスターなら、サーバーにも保存してメンバー全員に同期する
   *  （ユーザー指示：見た目の設定もルームマスターに委ねて同期したい）。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeId = id;
    this.lens.setFrameShape(id);
    this.pushAppearanceIfMaster();
  }

  /** 操作パネルのAppearanceSelectorで選ばれた柄・質感を適用する。
   *  ルーム未接続のプレースホルダーにも同じように即座に反映される。挙動は
   *  setFrameShapeと同じ（ルームマスターならサーバーに保存して同期する）。 */
  setFramePattern(id: FramePatternId): void {
    this.framePatternId = id;
    this.lens.setFramePattern(id);
    this.pushAppearanceIfMaster();
  }

  private pushAppearanceIfMaster(): void {
    if (!this.selectedRoomId || !this.isRoomMaster()) return;
    void updateSharedAppearance(this.selectedRoomId, this.frameShapeId, this.framePatternId).catch((e) => {
      console.error("[smuiView] appearance save failed", e);
    });
  }

  /** ポーリング/WS経由でサーバー側の見た目(フレームの形・柄)を受け取った時に
   *  適用する。未設定(null)ならローカルの既定値を保ったままにする——setFrameShape/
   *  setFramePatternと違い、こちらはサーバーへ書き戻さない（自分が発生源では
   *  ないため、書き戻すと無意味なPATCHが発生するだけになる）。 */
  private applyRemoteAppearance(shapeId: FrameShapeId | null, patternId: FramePatternId | null): void {
    if (shapeId) this.frameShapeId = shapeId;
    if (patternId) this.framePatternId = patternId;
    this.lens.setFrameShape(this.frameShapeId);
    this.lens.setFramePattern(this.framePatternId);
  }

  /** main.tsのframe()ループから、共有タブを見ている間だけ呼んでよい。
   *  AppearanceSelector（main.ts所有）を、ルーム未接続なら通常のローカル
   *  編集用に戻し(null)、ルーム接続中ならこのルームの値・ロック状態
   *  （ルームマスター以外は変更不可）を反映させるために使う。 */
  getAppearanceSync(): { locked: boolean; shapeId: FrameShapeId; patternId: FramePatternId } | null {
    if (!this.selectedRoomId) return null;
    return { locked: !this.isRoomMaster(), shapeId: this.frameShapeId, patternId: this.framePatternId };
  }

  /** ルームを選択済みか。ExportSection(exportControl.ts)が、ルーム未選択時に
   *  プレースホルダーの空Storeを書き出し対象にしてしまわないよう判定するのに使う。 */
  hasSelectedRoom(): boolean {
    return this.selectedRoomId !== null;
  }

  /** 表示中かどうかにかかわらず呼んでよい。 */
  setActive(active: boolean): void {
    this.active = active;
    this.applyRestrictions();
  }

  closeWritingSessions(): void {
    this.lens.closeWritingSession();
  }

  finishTextEditingIfOpen(): void {
    this.lens.finishTextEditingIfOpen();
  }

  /** 道具バーの「戻る」ボタン（issue #90）用。 */
  undo(): void {
    this.lens.undo();
  }

  createExportImage(): Promise<Blob> {
    return this.lens.createExportImage();
  }

  getExportText(): string {
    return this.lens.getExportText();
  }

  render(now: number): void {
    if (!this.active) return;
    this.lens.render(now);
    this.updateReviveInfoPill(now);
    this.sessionPanel.update(now, this.isRoomMaster(), this.session);
  }

  /** 「残り時間」ピルの中身を今の状況に合わせる。投票フェーズ中は、時間で
   *  消える猶予という個人キャンバス向けの文言をそのまま出しても意味が
   *  無く、代わりにホバー中のメモの相対的な支持率(%)を見たい
   *  （issue #79：共有ビューなのに「あと1日」等の個人向け表示が出てくる
   *  というユーザー指摘への対応）。確定済み(fadeExempt)のメモも、時間経過で
   *  フェードしない仕様である以上「残り時間」は意味を持たないため隠す。 */
  private updateReviveInfoPill(now: number): void {
    const memoId = this.lens.getHoverMemoId();
    const memo = memoId ? (this.sharedStore?.getAll().find((m) => m.id === memoId) ?? null) : null;

    if (this.session?.phase === "voting" && memo) {
      const memos = this.sharedStore!.getAll();
      const maxHeat = Math.max(1, ...memos.filter((m) => !m.fadeExempt).map((m) => m.heat ?? 0));
      this.reviveInfoPill.updateSupport(Math.round(((memo.heat ?? 0) / maxHeat) * 100));
      return;
    }
    if (memo?.fadeExempt) {
      this.reviveInfoPill.update(null);
      return;
    }
    this.reviveInfoPill.update(this.lens.getHoverRemainingMs(now));
  }

  /** キャンバスタブと同じく、共有タブでもズーム中はヘッダー/ツールバーを
   *  薄くするための判定（main.ts参照）。 */
  isZoomed(): boolean {
    return this.lens.isZoomed();
  }
}
