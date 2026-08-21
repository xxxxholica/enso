import "./style.css";
import { CircularCanvas } from "./canvasView";
import { ArchiveView } from "./archiveView";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { DurationSelector } from "./durationSelector";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { mountAccountWidget } from "./clerkAccount";
import { refreshFromCloud, schedulePush, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";
import { SharedCanvasView } from "./sharedCanvasView";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <nav class="view-nav">
      <button type="button" class="view-nav-btn" data-view="canvas">キャンバス</button>
      <button type="button" class="view-nav-btn" data-view="archive">振り返り</button>
      <button type="button" class="view-nav-btn" data-view="shared">共有</button>
    </nav>
    <div id="account-slot"></div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel"></div>
    <div id="archive-panel" class="view-panel" hidden></div>
    <div id="shared-panel" class="view-panel" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <div id="primary-slot"></div>
      <div id="duration-slot" class="bottom-bar-fade"></div>
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

void mountAccountWidget(document.querySelector<HTMLDivElement>("#account-slot")!, (session) => {
  if (session) {
    setTokenGetter(session.getToken);
    void syncOnSignIn(store);
    disconnectRealtime = connectRealtimeSync(session, () => {
      void refreshFromCloud(store);
    });
  } else {
    setTokenGetter(null);
    disconnectRealtime?.();
    disconnectRealtime = null;
  }
});

const canvasPanel = document.querySelector<HTMLDivElement>("#canvas-panel")!;
const archivePanel = document.querySelector<HTMLDivElement>("#archive-panel")!;
const sharedPanel = document.querySelector<HTMLDivElement>("#shared-panel")!;
// 道具バー（キャンバス表示中）と、振り返り用のシークバー（振り返り表示中）は
// 同じ場所（操作パネルの上段）を共有する。表示中の画面に応じてどちらかだけを見せる。
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;

const onToolOrDurationChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
};
const toolbar = new Toolbar(primarySlot, onToolOrDurationChange, (id) => canvasView.beginPlacingTemplate(id));
const durationSelector = new DurationSelector(durationSlot, onToolOrDurationChange);

const canvasView = new CircularCanvas(canvasPanel, store, () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  lifespanDays: durationSelector.getLifespanDays(),
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
}));
const archiveView = new ArchiveView(archivePanel, primarySlot, store);
const sharedView = new SharedCanvasView(sharedPanel, () => setView("shared"));
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// 画面切り替え時、道具バー・時間選択ブロックをふわっとフェードイン／
// フェードアウトさせる（archiveViewのシークバーも同じ仕組み。ユーザー指示）。
const setToolbarVisible = createFadeVisibility(toolbarEl);
const setDurationVisible = createFadeVisibility(durationSlot);
// 初期表示（キャンバス）ではフェードインさせず、最初から見えている状態にする。
toolbarEl.classList.add("is-visible");
durationSlot.classList.add("is-visible");

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
  canvasPanel.hidden = view !== "canvas";
  archivePanel.hidden = view !== "archive";
  sharedPanel.hidden = view !== "shared";
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });

  // まず今表示している下部バーの中身を丸ごとフェードアウトさせる。
  setToolbarVisible(false);
  setDurationVisible(false);
  archiveView.setActive(false);
  sharedView.setActive(false);

  window.setTimeout(() => {
    // フェードアウト待ちの間にさらに別の画面へ切り替えられていた場合は、
    // 古い方のフェードインは行わない（最後に呼ばれた切り替えだけを反映する）。
    if (currentView !== view) return;
    setToolbarVisible(view === "canvas");
    // 時間選択ブロック（DurationSelector）はキャンバス表示中だけ意味を持つ
    // （振り返り中はそのシークバーが#primary-slotを占有し、共有中はそもそも
    // 道具を持たないため）。
    setDurationVisible(view === "canvas");
    archiveView.setActive(view === "archive");
    sharedView.setActive(view === "shared");
    if (view === "archive") archiveView.render();
  }, FADE_TRANSITION_MS);
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "archive" | "shared"));
});
// 初期表示（キャンバス）はフェードなしで即座に反映する。道具バー・時間選択
// ブロックは既にis-visibleを付けてあるので、ここではパネルとナビの見た目だけ揃える。
canvasPanel.hidden = false;
archivePanel.hidden = true;
sharedPanel.hidden = true;
document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.style.opacity = btn.dataset.view === "canvas" ? "1" : "0.45";
});

function frame(): void {
  const now = Date.now();
  const changed = store.tick(now);
  canvasView.render(now);
  if (changed && currentView === "archive") archiveView.render();
  if (currentView === "shared") sharedView.render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
