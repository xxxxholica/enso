import "./style.css";
import { CircularCanvas } from "./canvasView";
import { ArchiveView } from "./archiveView";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import type { ToolbarTool } from "./toolbar";
import { DurationSelector } from "./durationSelector";
import { AppearanceSelector } from "./appearanceSelector";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { setupControlPanelPages } from "./controlPanelPages";
import { mountAccountWidget } from "./clerkAccount";
import { refreshFromCloud, schedulePush, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";
import { SharedRoomMenu } from "./sharedRoomMenu";
import { SmuiView } from "./smuiView";
import { loadFramePattern, loadFrameShape, saveFramePattern, saveFrameShape } from "./storage";
import { TemplatePicker } from "./templatePicker";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <nav class="view-nav">
      <button type="button" class="view-nav-btn" data-view="canvas">キャンバス</button>
      <button type="button" class="view-nav-btn" data-view="archive">振り返り</button>
      <button type="button" class="view-nav-btn" data-view="shared">共有</button>
    </nav>
    <div class="app-header-right">
      <div id="account-slot"></div>
    </div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel fade-visible"></div>
    <div id="archive-panel" class="view-panel fade-visible" hidden></div>
    <div id="shared-panel" class="view-panel fade-visible" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <div class="control-panel-dots" aria-hidden="true">
        <button type="button" class="control-panel-dot" data-page="0"></button>
        <button type="button" class="control-panel-dot" data-page="1"></button>
      </div>
      <div class="control-panel-pages">
        <div id="primary-slot"></div>
        <div id="duration-slot" class="fade-visible"></div>
      </div>
    </div>
  </footer>
`;

// ログイン中は、ローカルの変更（描画・削除・移動など）が起きるたびに
// クラウド保存を予約する（連続する変更はデバウンスされ、まとめて1回送られる）。
// 未ログイン時はsetTokenGetter(null)状態なのでschedulePushは何もしない。
const store = new MemoStore((memos) => schedulePush(memos));

// ログイン中は、他端末での変更をWebSocket通知で受け取り、その都度クラウドから
// 取得し直してローカルに反映する（＝ページを開いたままでも他端末の変更が自動で見える）。
// ログアウト時はdisconnectRealtimeを呼んで接続を切る。
let disconnectRealtime: (() => void) | null = null;
// 共有キャンバス（ルーム）を選んだ時、そのcanvasIdの変更通知を受け取れる
// ようにするための橋渡し。ログイン中だけ実体を持つ（SharedRoomMenuの
// onSelectRoomから呼ぶ。selectRoom自体はスクロールの都合でsmuiViewが持つ）。
let subscribeToRoom: ((canvasId: string) => void) | null = null;

void mountAccountWidget(document.querySelector<HTMLDivElement>("#account-slot")!, (session) => {
  if (session) {
    setTokenGetter(session.getToken);
    void syncOnSignIn(store);
    const realtime = connectRealtimeSync(
      session,
      () => void refreshFromCloud(store),
      (canvasId) => smuiView.notifyRemoteChangeIfCurrent(canvasId)
    );
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
const archivePanel = document.querySelector<HTMLDivElement>("#archive-panel")!;
const sharedPanel = document.querySelector<HTMLDivElement>("#shared-panel")!;
const controlPanel = document.querySelector<HTMLDivElement>(".control-panel")!;
// 道具バー（キャンバス表示中）と、振り返り用のシークバー（振り返り表示中）は
// 同じ場所（操作パネルの上段）を共有する。表示中の画面に応じてどちらかだけを見せる。
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;

// 「消えるまでの期間」は、新しくメモを作る道具（ペン・マーカー・テキスト）を
// 選んでいる間だけ意味を持つ。それ以外（移動・消しゴム・なぞる）の間はスライダーを
// 触れなくする（ユーザー指示：無効か有効かを分かりやすくしたい。なぞる道具の
// 回復量は寿命の15%固定・生涯の上限つきの自動計算になったため、こちらも
// スライダーで選ぶものが無くなっている——durationSelector.tsのsetEnabled参照）。
const TOOLS_USING_DURATION: ReadonlySet<ToolbarTool> = new Set(["pen", "marker", "text"]);
const onToolOrDurationChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
  smuiView.closeWritingSessions();
  smuiView.finishTextEditingIfOpen();
  durationSelector.setEnabled(TOOLS_USING_DURATION.has(toolbar.getTool()));
};
// テンプレート挿入は「今表示中の画面」の共有キャンバス／通常キャンバスに置く
// （道具バー自体はキャンバス・共有の両画面で共通の1つのインスタンスを使い回すため）。
const toolbar = new Toolbar(primarySlot, onToolOrDurationChange, (id) => {
  if (currentView === "shared") smuiView.beginPlacingTemplate(id);
  else canvasView.beginPlacingTemplate(id);
});
const durationSelector = new DurationSelector(durationSlot, onToolOrDurationChange);
// 初期道具（ペン）は使うので、最初から有効な見た目にしておく。
durationSelector.setEnabled(TOOLS_USING_DURATION.has(toolbar.getTool()));

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
  lifespanDays: durationSelector.getLifespanDays(),
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
});

const canvasView = new CircularCanvas(canvasPanel, store, getToolState, {
  onRequestTemplatePicker: openTemplatePicker,
});
const archiveView = new ArchiveView(archivePanel, primarySlot, store);
// SMUI（眼鏡ビュー）: 「共有」タブ。個人キャンバスは含まず、大きな眼鏡形状1枚
// （左右レンズ+ブリッジが1つの連続領域）だけの共有キャンバスを表示する
// ——選んだ共有キャンバス（ルーム）のMemoStoreだけを扱う（個人MemoStoreの
// storeはcanvasView/archiveViewにのみ渡す）。
// ルームの作成・選択（SharedRoomMenu）・見た目の設定（AppearanceSelector、
// フレームの形・色）は、いずれも眼鏡キャンバスの下に横並びで埋め込む
// （smuiView.getRoomMenuSlot()/getAppearanceSlot()、ユーザー指示）——
// smuiView自身がsharedPanelのhidden属性で他の2画面では自動的に隠れるため、
// 個別のフェード処理は不要。
let frameShapeId = loadFrameShape();
let framePatternId = loadFramePattern();
const smuiView = new SmuiView(sharedPanel, getToolState, frameShapeId, framePatternId, openTemplatePicker);
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// 画面切り替え時、道具バー・時間選択ブロックをふわっとフェードイン／
// フェードアウトさせる（archiveViewのシークバーも同じ仕組み。ユーザー指示）。
const setToolbarVisible = createFadeVisibility(toolbarEl);
const setDurationVisible = createFadeVisibility(durationSlot);
// キャンバス本体（#canvas-panel等）も、下部バーと同じくふわっとフェードイン／
// フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
// 切り替えたい）。3つのパネルは#app-main内で横並びのflexアイテムのため、
// 下部バーと同じ理由（新旧が同時に表示されるとレイアウトが崩れる）で、
// クロスフェードではなく逐次の入れ替えにする——setView()参照。
const setCanvasPanelVisible = createFadeVisibility(canvasPanel);
const setArchivePanelVisible = createFadeVisibility(archivePanel);
const setSharedPanelVisible = createFadeVisibility(sharedPanel);
// 初期表示（キャンバス）ではフェードインさせず、最初から見えている状態にする。
toolbarEl.classList.add("is-visible");
durationSlot.classList.add("is-visible");
canvasPanel.classList.add("is-visible");

// 振り返りの下部バー（シークバー1ブロック）が、キャンバス表示中の下部バー
// （道具バー＋時間選択ブロックの3ブロック）と同じ横幅になるよう、実測値で揃える
// （ユーザー指摘：振り返りバーだけキャンバス側より長くなって見づらい）。
// CSSの固定値ではなく実測にしているのは、道具バー・時間選択ブロックの中身が
// 変わって横幅が変化しても追従できるようにするため。
const syncSeekbarWidth = () => {
  const toolbarWidth = toolbarEl.getBoundingClientRect().width;
  const durationWidth = durationSlot.getBoundingClientRect().width;
  // 振り返り表示中はこの2つがhidden（=display:none）になり幅が0になる
  // ——そのタイミングでResizeObserverが発火しても更新せず、直前の正しい
  // 実測値をそのまま使い続ける（0で上書きすると振り返りバーが潰れてしまう）。
  if (toolbarWidth === 0 || durationWidth === 0) return;
  const gapPx = parseFloat(getComputedStyle(controlPanel).columnGap) || 0;
  archiveView.setSeekbarWidth(toolbarWidth + gapPx + durationWidth);
};
new ResizeObserver(syncSeekbarWidth).observe(toolbarEl);
new ResizeObserver(syncSeekbarWidth).observe(durationSlot);
syncSeekbarWidth();

new AppearanceSelector(
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
  () => setView("shared")
);

// --- 画面切り替え -------------------------------------------------------
let currentView: "canvas" | "archive" | "shared" = "canvas";

/**
 * 画面（キャンバス／振り返り／共有）を切り替える。下部バーの中身（道具バー・
 * 時間選択ブロック・振り返りシークバー）は、新旧のブロックを同時にフェード
 * させて重ねて見せる「クロスフェード」ではなく、今の中身を完全にフェード
 * アウトさせてから、新しい中身に丸ごと入れ替えてフェードインさせる
 * （ユーザー指示）。道具バー（3ブロック）と振り返りシークバーは同じ
 * #primary-slotを共有しているため、同時に表示すると遷移中だけ両方が
 * 並んで表示されてしまい、レイアウトが一瞬崩れて見えるのを避けるため。
 */
function setView(view: "canvas" | "archive" | "shared"): void {
  if (view === currentView) return;
  currentView = view;
  canvasView.finishTextEditingIfOpen();
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });

  // まず今表示しているキャンバス本体・下部バー・ヘッダーの中身を丸ごと
  // フェードアウトさせる（ユーザー指示：キャンバスも下部バーと同様に滑らかに
  // 切り替えたい）。hidden属性を戻すのはフェード完了後（createFadeVisibility内の
  // タイマー）なので、ここではまだ外していない側のパネルは見えたまま薄くなっていく。
  setCanvasPanelVisible(false);
  setArchivePanelVisible(false);
  setSharedPanelVisible(false);
  setToolbarVisible(false);
  setDurationVisible(false);
  archiveView.setActive(false);
  smuiView.setActive(false);

  window.setTimeout(() => {
    // フェードアウト待ちの間にさらに別の画面へ切り替えられていた場合は、
    // 古い方のフェードインは行わない（最後に呼ばれた切り替えだけを反映する）。
    if (currentView !== view) return;
    setCanvasPanelVisible(view === "canvas");
    setArchivePanelVisible(view === "archive");
    setSharedPanelVisible(view === "shared");
    // 道具バーはキャンバス表示中に加え、SMUI（共有）の左右レンズでも描画に
    // 使うため表示する。時間選択ブロック（DurationSelector）は振り返り中は
    // そのシークバーが#primary-slotを占有するため両方とも表示しない。
    setToolbarVisible(view === "canvas" || view === "shared");
    setDurationVisible(view === "canvas" || view === "shared");
    archiveView.setActive(view === "archive");
    smuiView.setActive(view === "shared");
    if (view === "archive") archiveView.render();
  }, FADE_TRANSITION_MS);
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "archive" | "shared"));
});
// 初期表示（キャンバス）はフェードなしで即座に反映する。#canvas-panel・道具バー・
// 時間選択ブロックはテンプレート側の初期状態（hiddenなし）＋既にis-visibleを
// 付けてあるので、ここではナビの見た目だけ揃える。
document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.style.opacity = btn.dataset.view === "canvas" ? "1" : "0.45";
});

function frame(): void {
  const now = Date.now();
  const changed = store.tick(now);
  if (currentView === "canvas") canvasView.render(now);
  if (changed && currentView === "archive") archiveView.render();
  if (currentView === "shared") smuiView.render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
