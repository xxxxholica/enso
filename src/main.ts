import "./style.css";
import { CircularCanvas } from "./canvasView";
import { FIXED_LIFESPAN_DAYS } from "./fade";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { RewindSelector } from "./rewindSelector";
import { AppearanceSelector } from "./appearanceSelector";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { setupControlPanelPages } from "./controlPanelPages";
import { ReviveInfoPill } from "./reviveInfoPill";
import { mountAccountWidget } from "./clerkAccount";
import { pushOp, refreshFromCloud, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";
import { SettingsMenu } from "./settingsMenu";
import { SharedRoomMenu } from "./sharedRoomMenu";
import { SmuiView } from "./smuiView";
import {
  loadFramePattern,
  loadFrameShape,
  loadThemePreference,
  saveFramePattern,
  saveFrameShape,
  saveThemePreference,
} from "./storage";
import { TemplatePicker } from "./templatePicker";
import { applyTheme } from "./theme";

// テーマ（自動/ライト/ダーク）は、他の何よりも先に適用する——後回しにすると
// 一瞬ライトテーマで描画されてからダークへ切り替わる「ちらつき」が見える
// ため（ユーザー指示：設定ボタンを追加してテーマ変更機能を入れたい）。
applyTheme(loadThemePreference());

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="app-header-left">
      <h1 class="app-wordmark">円相</h1>
    </div>
    <div class="app-header-right">
      <nav class="view-nav">
        <button type="button" class="view-nav-btn" data-view="canvas">キャンバス</button>
        <button type="button" class="view-nav-btn" data-view="shared">共有</button>
      </nav>
      <div id="settings-slot"></div>
    </div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel fade-visible">
      <div id="canvas-wrap"></div>
      <div id="canvas-info-row" class="info-row"></div>
    </div>
    <div id="shared-panel" class="view-panel fade-visible" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <div class="control-panel-dots" aria-hidden="true">
        <button type="button" class="control-panel-dot" data-page="0"></button>
        <button type="button" class="control-panel-dot" data-page="1"></button>
        <button type="button" class="control-panel-dot" data-page="2"></button>
      </div>
      <div class="control-panel-pages">
        <div id="primary-slot"></div>
        <div id="duration-slot" class="fade-visible"></div>
      </div>
    </div>
  </footer>
`;

// ログイン中は、ローカルの変更（描画・削除・移動など）が起きるたびに、触れた
// メモ単位でクラウド保存を予約する（連続する変更は短くデバウンスされ、まとめて
// 送られる、issue #99）。未ログイン時はsetTokenGetter(null)状態なのでpushOpは
// 何もしない。
const store = new MemoStore(undefined, true, (op) => pushOp(op));

// ログイン中は、他端末での変更をWebSocket通知で受け取り、その都度クラウドから
// 取得し直してローカルに反映する（＝ページを開いたままでも他端末の変更が自動で見える）。
// ログアウト時はdisconnectRealtimeを呼んで接続を切る。
let disconnectRealtime: (() => void) | null = null;
// 共有キャンバス（ルーム）を選んだ時、そのcanvasIdの変更通知を受け取れる
// ようにするための橋渡し。ログイン中だけ実体を持つ（SharedRoomMenuの
// onSelectRoomから呼ぶ。selectRoom自体はスクロールの都合でsmuiViewが持つ）。
let subscribeToRoom: ((canvasId: string) => void) | null = null;

// 設定メニュー（テーマ・使い方に加え、アカウント区画を持つ）を先に作り、その
// アカウント区画の枠にmountAccountWidgetでClerkの中身（未ログイン時のログイン
// ボタン／ログイン中のユーザーアイコン・メニュー）を描き込む——以前はヘッダーに
// 独立した専用の枠(#account-slot)を持っていたが、設定ボタンの隣に並んでいるのが
// 冗長という指摘のため、設定メニューの中へ完全に統合した。
const settingsSlot = document.querySelector<HTMLDivElement>("#settings-slot")!;
const settingsMenu = new SettingsMenu(settingsSlot, loadThemePreference(), (pref) => {
  saveThemePreference(pref);
  applyTheme(pref);
});

void mountAccountWidget(settingsMenu.getAccountSlot(), (session) => {
  if (session) {
    setTokenGetter(session.getToken);
    void syncOnSignIn(store);
    const realtime = connectRealtimeSync(session, {
      onPersonalMemoUpserted: (memo) => store.applyRemoteUpsert(memo),
      onPersonalMemoDeleted: (memoId) => store.applyRemoteDelete(memoId),
      onSharedChanged: (canvasId) => smuiView.notifyRemoteChangeIfCurrent(canvasId),
      onSessionChanged: (canvasId, sessionState) => smuiView.notifySessionChanged(canvasId, sessionState),
      onHeatChanged: (canvasId, memoId, heat) => smuiView.notifyHeatChanged(canvasId, memoId, heat),
      onMemoUpserted: (canvasId, memo) => smuiView.notifyMemoUpserted(canvasId, memo),
      onMemoDeleted: (canvasId, memoId) => smuiView.notifyMemoDeleted(canvasId, memoId),
      onReconnected: () => {
        void refreshFromCloud(store);
        smuiView.notifyReconnected();
      },
    });
    disconnectRealtime = realtime.disconnect;
    subscribeToRoom = realtime.subscribeToRoom;
  } else {
    setTokenGetter(null);
    disconnectRealtime?.();
    disconnectRealtime = null;
    subscribeToRoom = null;
  }
});

const canvasPanel = document.querySelector<HTMLDivElement>("#canvas-panel")!;
const canvasWrap = document.querySelector<HTMLDivElement>("#canvas-wrap")!;
const sharedPanel = document.querySelector<HTMLDivElement>("#shared-panel")!;
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;
// 「残り時間」ピル（キャンバスタブ）: ツールバー直上の行に、共有タブの
// 「＋ルームを作成」等と同じ見た目で置く（ユーザー指示）。共有タブ側は
// smuiView自身が同じ行の中で持つ（getRoomMenuSlot()の横）。
const canvasReviveInfoPill = new ReviveInfoPill(document.querySelector<HTMLDivElement>("#canvas-info-row")!);

const onToolChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
  smuiView.closeWritingSessions();
  smuiView.finishTextEditingIfOpen();
};
// テンプレート挿入・「戻る」はどちらも「今表示中の画面」の共有キャンバス／
// 通常キャンバスに対して行う（道具バー自体はキャンバス・共有の両画面で
// 共通の1つのインスタンスを使い回すため）。
const toolbar = new Toolbar(
  primarySlot,
  onToolChange,
  (id) => {
    if (currentView === "shared") smuiView.beginPlacingTemplate(id);
    else canvasView.beginPlacingTemplate(id);
  },
  () => {
    if (currentView === "shared") smuiView.undo();
    else canvasView.undo();
  }
);
// 「消えるまでの期間」は選べる仕様をやめ常に1日固定にした（fade.tsのFIXED_LIFESPAN_DAYS）
// ため、この枠は旧振り返りビューが持っていた「過去に遡って見る」スライダーとして
// 転用する（ユーザー指示）。個人キャンバス専用の機能なので、キャンバス表示中だけ
// 触れる（setDurationVisible参照）——共有キャンバスの描画には影響しない。
const onRewindChange = () => {
  const rewindAt = rewindSelector.getRewindAt();
  canvasView.setRewindAt(rewindAt);
  toolbar.setEnabled(rewindAt === null);
};
const rewindSelector = new RewindSelector(durationSlot, onRewindChange);

// スマホ幅では#primary-slot・#duration-slotの2ブロックを1画面にまとめ、上下
// スワイプで切り替える（ユーザー指示）。デスクトップ幅では.control-panel-pagesが
// display:contentsになりスクロールが発生しないため、常時呼んでおいて問題ない。
// Toolbar/DurationSelectorが実際の中身（.toolbar-tools等）を描画し終えた後で
// 呼ぶ必要がある——先に呼ぶと.control-panel-pagesがまだ空の状態で初期スクロール
// 位置を決めてしまい、後から中身が増えた拍子にscroll-snapが2段目へずれてしまう
// （実機・自動テストで再現確認済み）。
setupControlPanelPages(
  document.querySelector<HTMLDivElement>(".control-panel-pages")!,
  document.querySelector<HTMLDivElement>(".control-panel-dots")!
);

// 空のキャンバスの「＋テンプレートを使用」から開く全画面のテンプレート選択。
// 選ばれたテンプレートは道具バー経由でそのまま盤面に置く（道具をテキストに切り替える
// 副作用も含めて、以前の道具バーのテンプレートボタンとまったく同じ流れ）。
// キャンバス／共有のどちらのタブから開いても、行き先の振り分けは上のToolbarの
// onInsertTemplateがcurrentViewを見て行うため、選択画面自体は1つで足りる
// ——全画面の幕がヘッダーのタブ切り替えごと覆うので、開いている間にタブが
// 変わることもない。
const templatePicker = new TemplatePicker((id) => toolbar.insertTemplate(id));
const openTemplatePicker = () => templatePicker.open();

const getToolState = () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  lifespanDays: FIXED_LIFESPAN_DAYS,
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
  eraserRadius: toolbar.getEraserRadius(),
});

const canvasView = new CircularCanvas(canvasWrap, store, getToolState, {
  onRequestTemplatePicker: openTemplatePicker,
});
// SMUI（眼鏡ビュー）: 「共有」タブ。個人キャンバスは含まず、大きな眼鏡形状1枚
// （左右レンズ+ブリッジが1つの連続領域）だけの共有キャンバスを表示する
// ——選んだ共有キャンバス（ルーム）のMemoStoreだけを扱う（個人MemoStoreの
// storeはcanvasViewにのみ渡す）。
// ルームの作成・選択（SharedRoomMenu）・見た目の設定（AppearanceSelector、
// フレームの形・色）は、いずれも眼鏡キャンバスの下に横並びで埋め込む
// （smuiView.getRoomMenuSlot()/getAppearanceSlot()、ユーザー指示）——
// smuiView自身がsharedPanelのhidden属性で他の2画面では自動的に隠れるため、
// 個別のフェード処理は不要。
let frameShapeId = loadFrameShape();
let framePatternId = loadFramePattern();
const smuiView = new SmuiView(sharedPanel, getToolState, frameShapeId, framePatternId, toolbar, openTemplatePicker);
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// 画面切り替え時、道具バー・振り返りスライダーをふわっとフェードイン／
// フェードアウトさせる（ユーザー指示）。
const setToolbarVisible = createFadeVisibility(toolbarEl);
const setDurationVisible = createFadeVisibility(durationSlot);
// キャンバス本体（#canvas-panel等）も、下部バーと同じくふわっとフェードイン／
// フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
// 切り替えたい）。2つのパネルは#app-main内で横並びのflexアイテムのため、
// 下部バーと同じ理由（新旧が同時に表示されるとレイアウトが崩れる）で、
// クロスフェードではなく逐次の入れ替えにする——setView()参照。
const setCanvasPanelVisible = createFadeVisibility(canvasPanel);
const setSharedPanelVisible = createFadeVisibility(sharedPanel);
// 初期表示（キャンバス）ではフェードインさせず、最初から見えている状態にする。
toolbarEl.classList.add("is-visible");
durationSlot.classList.add("is-visible");
canvasPanel.classList.add("is-visible");

const appearanceSelector = new AppearanceSelector(
  smuiView.getAppearanceSlot(),
  frameShapeId,
  framePatternId,
  (id) => {
    frameShapeId = id;
    saveFrameShape(id);
    smuiView.setFrameShape(id);
  },
  (id) => {
    framePatternId = id;
    saveFramePattern(id);
    smuiView.setFramePattern(id);
  }
);

// 共有キャンバス（ルーム）の作成・選択・招待リンクのメニュー。招待リンク経由の
// 自動参加（?join=...）は表示中の画面と無関係に裏で動くため、ボタン自体は
// 常に生成しておく。
new SharedRoomMenu(
  smuiView.getRoomMenuSlot(),
  (id) => {
    subscribeToRoom?.(id);
    void smuiView.selectRoom(id);
  },
  () => setView("shared"),
  // 招待リンク経由のログイン不要のゲスト参加(issue #79)。Clerkのsession(=
  // AuthSession)を持たないため、payload.tokenGetterをゲストトークンだけ
  // 返すダックタイプのオブジェクトに差し替えて、mountAccountWidgetの
  // ログイン時と同じconnectRealtimeSyncの配線をそのまま流用する。
  (canvasId, guestAuth) => {
    const realtime = connectRealtimeSync(
      { getToken: async () => guestAuth.token },
      {
        onPersonalMemoUpserted: () => {},
        onPersonalMemoDeleted: () => {},
        onSharedChanged: (cid) => smuiView.notifyRemoteChangeIfCurrent(cid),
        onSessionChanged: (cid, sessionState) => smuiView.notifySessionChanged(cid, sessionState),
        onHeatChanged: (cid, memoId, heat) => smuiView.notifyHeatChanged(cid, memoId, heat),
        onMemoUpserted: (cid, memo) => smuiView.notifyMemoUpserted(cid, memo),
        onMemoDeleted: (cid, memoId) => smuiView.notifyMemoDeleted(cid, memoId),
        onReconnected: () => smuiView.notifyReconnected(),
      }
    );
    disconnectRealtime = realtime.disconnect;
    subscribeToRoom = realtime.subscribeToRoom;
    subscribeToRoom(canvasId);
    void smuiView.selectRoom(canvasId);
    setView("shared");
  }
);

// --- 画面切り替え -------------------------------------------------------
let currentView: "canvas" | "shared" = "canvas";

// キャンバス／共有タブをURLに反映する。パス（例: /shared）ではなくクエリ
// パラメータにしているのは、静的ホスティング（Vercel/Netlify/GitHub Pages等、
// README参照）によってはSPAのパスをindex.htmlへフォールバックさせる設定が
// 無く、/sharedを直接開く・リロードすると404になりかねないため——クエリ
// パラメータなら常に同じindex.htmlが返るのでその心配がない。
const VIEW_PARAM = "view";

function readInitialView(): "canvas" | "shared" {
  return new URLSearchParams(location.search).get(VIEW_PARAM) === "shared" ? "shared" : "canvas";
}

// 「共有」タブにいる間にリロードすると「キャンバス」タブへ戻ってしまい
// 不便、というユーザー指摘の対応。canvasの時はパラメータ自体を消して
// URLを素のままにする（joinパラメータの扱いと同じ考え方、sharedRoomMenu.ts参照）。
function syncViewUrl(view: "canvas" | "shared"): void {
  const url = new URL(location.href);
  if (view === "shared") url.searchParams.set(VIEW_PARAM, "shared");
  else url.searchParams.delete(VIEW_PARAM);
  history.replaceState(null, "", url);
}

/**
 * 画面（キャンバス／共有）を切り替える。下部バーの中身（道具バー・振り返り
 * スライダー）は、今の中身を完全にフェードアウトさせてから、新しい中身に
 * 丸ごと入れ替えてフェードインさせる（ユーザー指示）。
 */
function setView(view: "canvas" | "shared"): void {
  if (view === currentView) return;
  canvasView.finishTextEditingIfOpen();
  // 振り返りスライダーは個人キャンバス専用の機能。共有タブへ移る間、
  // 遡ったままだと道具バーが無効化されたまま戻らなくなってしまう
  // （道具バーはキャンバス・共有の両タブで共通の1つのインスタンスのため）
  // ので、キャンバスタブを離れる時点で「たった今」に戻しておく。
  if (currentView === "canvas") rewindSelector.reset();
  currentView = view;
  syncViewUrl(view);
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });

  // まず今表示しているキャンバス本体・下部バー・ヘッダーの中身を丸ごと
  // フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
  // 切り替えたい）。hidden属性を戻すのはフェード完了後（createFadeVisibility内の
  // タイマー）なので、ここではまだ外していない側のパネルは見えたまま薄くなっていく。
  setCanvasPanelVisible(false);
  setSharedPanelVisible(false);
  setToolbarVisible(false);
  setDurationVisible(false);
  smuiView.setActive(false);

  window.setTimeout(() => {
    // フェードアウト待ちの間にさらに別の画面へ切り替えられていた場合は、
    // 古い方のフェードインは行わない（最後に呼ばれた切り替えだけを反映する）。
    if (currentView !== view) return;
    setCanvasPanelVisible(view === "canvas");
    setSharedPanelVisible(view === "shared");
    // 道具バーはキャンバス表示中に加え、SMUI（共有）の左右レンズでも描画に
    // 使うため表示する。振り返りスライダーは個人キャンバス専用なのでキャンバス
    // 表示中だけ出す。
    setToolbarVisible(view === "canvas" || view === "shared");
    setDurationVisible(view === "canvas");
    smuiView.setActive(view === "shared");
  }, FADE_TRANSITION_MS);
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "shared"));
});

const initialView = readInitialView();
// 既定（キャンバス）はフェードなしで即座に反映する。#canvas-panel・道具バー・
// 振り返りスライダーはテンプレート側の初期状態（hiddenなし）＋既にis-visibleを
// 付けてあるので、ここではナビの見た目だけ揃える。URLが共有タブを指している
// 場合だけ、setViewと同じ処理で切り替える（ユーザー指示：共有タブでリロード
// してもキャンバスに戻らないようにしたい）。
document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.style.opacity = btn.dataset.view === "canvas" ? "1" : "0.45";
});
if (initialView === "shared") setView("shared");

function frame(): void {
  const now = Date.now();
  store.tick(now);
  let zoomed = false;
  if (currentView === "canvas") {
    canvasView.render(now);
    canvasReviveInfoPill.update(canvasView.getHoverRemainingMs(now));
    zoomed = canvasView.isZoomed();
  }
  if (currentView === "shared") {
    smuiView.render(now);
    // ルーム接続中は見た目の設定をルームマスターに委ねて同期する
    // （ユーザー指示）——ルームマスター以外は選べないようにロックし、
    // ルームの値をAppearanceSelectorの表示にも反映する。setLocked/setValues
    // は値が変わらない限りDOMを触らないので、毎フレーム呼んでも無駄がない。
    const appearanceSync = smuiView.getAppearanceSync();
    if (appearanceSync) {
      appearanceSelector.setLocked(appearanceSync.locked);
      appearanceSelector.setValues(appearanceSync.shapeId, appearanceSync.patternId);
    } else {
      appearanceSelector.setLocked(false);
    }
    zoomed = smuiView.isZoomed();
  }
  // ヘッダー/ツールバーは画面全体に広がったキャンバスの上に固定オーバーレイ
  // として乗っているため、ズーム中（1倍より拡大）は下の絵が見えるよう薄くする
  // （style.css `#app.is-zoomed`、ユーザー指示）。
  app.classList.toggle("is-zoomed", zoomed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
