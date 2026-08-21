import "./style.css";
import { CircularCanvas } from "./canvasView";
import { ArchiveView } from "./archiveView";
import { ICONS } from "./icons";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { DurationSelector } from "./durationSelector";
import { mountAccountWidget } from "./clerkAccount";
import { schedulePush, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { SharedCanvasView } from "./sharedCanvasView";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div id="account-slot"></div>
  </header>
  <main class="app-main">
    <div id="canvas-panel" class="view-panel"></div>
    <div id="archive-panel" class="view-panel" hidden></div>
    <div id="shared-panel" class="view-panel" hidden></div>
  </main>
  <footer class="app-footer">
    <div class="control-panel">
      <nav class="view-nav">
        <button type="button" class="view-nav-btn" data-view="canvas">キャンバス</button>
        <button type="button" class="view-nav-btn" data-view="archive">振り返り</button>
        <button type="button" class="view-nav-btn" data-view="shared">共有</button>
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

void mountAccountWidget(document.querySelector<HTMLDivElement>("#account-slot")!, (session) => {
  if (session) {
    setTokenGetter(session.getToken);
    void syncOnSignIn(store);
  } else {
    setTokenGetter(null);
  }
});

const canvasPanel = document.querySelector<HTMLDivElement>("#canvas-panel")!;
const archivePanel = document.querySelector<HTMLDivElement>("#archive-panel")!;
const sharedPanel = document.querySelector<HTMLDivElement>("#shared-panel")!;
// 道具バー（キャンバス表示中）と、振り返り用のシークバー（振り返り表示中）は
// 同じ場所（操作パネルの上段）を共有する。表示中の画面に応じてどちらかだけを見せる。
const primarySlot = document.querySelector<HTMLDivElement>("#primary-slot")!;
const durationSlot = document.querySelector<HTMLDivElement>("#duration-slot")!;

// 道具バー・期間セレクタを先に組み立てる（＝フッターの高さを確定させてから
// キャンバスの初期サイズを計算させるため。順序を逆にすると、初回描画時に
// フッターがまだ空でキャンバスが大きすぎるサイズで一瞬計算されてしまう）
// 道具・色・消えるまでの期間のいずれかを切り替えたら、書きかけのセッションを閉じ、
// 編集中のテキストがあれば確定する（古いメモへ違う設定のまま追記されるのを防ぐ）
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
}));
const archiveView = new ArchiveView(archivePanel, primarySlot, store);
const sharedView = new SharedCanvasView(sharedPanel, () => setView("shared"));
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// --- 画面切り替え -------------------------------------------------------
let currentView: "canvas" | "archive" | "shared" = "canvas";

function setView(view: "canvas" | "archive" | "shared"): void {
  currentView = view;
  canvasView.finishTextEditingIfOpen();
  canvasPanel.hidden = view !== "canvas";
  archivePanel.hidden = view !== "archive";
  sharedPanel.hidden = view !== "shared";
  toolbarEl.hidden = view !== "canvas";
  durationSlot.hidden = view === "shared";
  archiveView.setActive(view === "archive");
  sharedView.setActive(view === "shared");
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });
  if (view === "archive") archiveView.render();
}

document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view as "canvas" | "archive" | "shared"));
});
setView("canvas");

// --- 全体リセット（確認を挟む。ダイアログではなくインライン確認） -------
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

// --- 描画ループ：毎フレーム不透明度を再計算して反映する -----------------
function frame(): void {
  const now = Date.now();
  const changed = store.tick(now);
  canvasView.render(now);
  if (changed && currentView === "archive") archiveView.render();
  if (currentView === "shared") sharedView.render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
