import "./style.css";
import { CircularCanvas } from "./canvasView";
import { ArchiveView } from "./archiveView";
import { ICONS } from "./icons";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { DurationSelector } from "./durationSelector";
import { mountAccountWidget } from "./clerkAccount";
import { refreshFromCloud, schedulePush, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div id="account-slot"></div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel"></div>
    <div id="archive-panel" class="view-panel" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <nav class="view-nav">
        <button type="button" class="view-nav-btn" data-view="canvas">キャンバス</button>
        <button type="button" class="view-nav-btn" data-view="archive">振り返り</button>
      </nav>
      <div id="primary-slot"></div>
      <div id="duration-slot"></div>
      <div class="reset-slot">
        <button type="button" id="reset-btn" class="icon-btn" aria-label="すべて消す">${ICONS.trash}</button>
        <span id="reset-confirm" class="reset-confirm" hidden>
          本当に消しますか？
          <button type="button" id="reset-yes" class="text-link">はい</button>
          <button type="button" id="reset-no" class="text-link">いいえ</button>
        </span>
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
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;

const onToolOrDurationChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
};
const toolbar = new Toolbar(primarySlot, onToolOrDurationChange);
const durationSelector = new DurationSelector(durationSlot, onToolOrDurationChange);

const canvasView = new CircularCanvas(canvasPanel, store, () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  lifespanDays: durationSelector.getLifespanDays(),
  fontSize: toolbar.getFontSize(),
}));
const archiveView = new ArchiveView(archivePanel, primarySlot, store);
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

let currentView: "canvas" | "archive" = "canvas";

function setView(view: "canvas" | "archive"): void {
  currentView = view;
  canvasView.finishTextEditingIfOpen();
  canvasPanel.hidden = view !== "canvas";
  archivePanel.hidden = view !== "archive";
  toolbarEl.hidden = view !== "canvas";
  archiveView.setActive(view === "archive");
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });
  if (view === "archive") archiveView.render();
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "archive"));
});
setView("canvas");

const resetBtn = document.querySelector<HTMLButtonElement>("#reset-btn")!;
const resetConfirm = document.querySelector<HTMLSpanElement>("#reset-confirm")!;
const resetYes = document.querySelector<HTMLButtonElement>("#reset-yes")!;
const resetNo = document.querySelector<HTMLButtonElement>("#reset-no")!;

resetBtn.addEventListener("click", () => {
  resetBtn.hidden = true;
  resetConfirm.hidden = false;
});
resetNo.addEventListener("click", () => {
  resetConfirm.hidden = true;
  resetBtn.hidden = false;
});
resetYes.addEventListener("click", () => {
  store.resetAll();
  resetConfirm.hidden = true;
  resetBtn.hidden = false;
  if (currentView === "archive") archiveView.render();
});

function frame(): void {
  const now = Date.now();
  const changed = store.tick(now);
  canvasView.render(now);
  if (changed && currentView === "archive") archiveView.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
