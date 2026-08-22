import "./style.css";
import { CircularCanvas } from "./canvasView";
import { ArchiveView } from "./archiveView";
import { MemoStore } from "./memoStore";
import { Toolbar } from "./toolbar";
import { DurationSelector } from "./durationSelector";
import { FrameShapeSelector } from "./frameShapeSelector";
import { createFadeVisibility, FADE_TRANSITION_MS } from "./fadeVisibility";
import { mountAccountWidget } from "./clerkAccount";
import { refreshFromCloud, schedulePush, setTokenGetter, syncOnSignIn } from "./cloudSync";
import { connectRealtimeSync } from "./realtimeSync";
import { SharedRoomMenu } from "./sharedRoomMenu";
import { SmuiView } from "./smuiView";
import { loadFrameShape, saveFrameShape } from "./storage";

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
      <div id="shared-room-menu-slot" hidden></div>
    </div>
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
      <div id="frame-shape-slot" class="bottom-bar-fade" hidden></div>
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
const frameShapeSlot = document.querySelector<HTMLDivElement>("#frame-shape-slot")!;
const sharedRoomMenuSlot = document.querySelector<HTMLDivElement>("#shared-room-menu-slot")!;

const onToolOrDurationChange = () => {
  canvasView.closeWritingSession();
  canvasView.finishTextEditingIfOpen();
  smuiView.closeWritingSessions();
  smuiView.finishTextEditingIfOpen();
};
// テンプレート挿入は「今表示中の画面」の左レンズ／通常キャンバスに置く
// （道具バー自体はキャンバス・SMUIの両画面で共通の1つのインスタンスを使い回すため）。
const toolbar = new Toolbar(primarySlot, onToolOrDurationChange, (id) => {
  if (currentView === "shared") smuiView.beginPlacingTemplate(id);
  else canvasView.beginPlacingTemplate(id);
});
const durationSelector = new DurationSelector(durationSlot, onToolOrDurationChange);

const getToolState = () => ({
  tool: toolbar.getTool(),
  color: toolbar.getColor(),
  lifespanDays: durationSelector.getLifespanDays(),
  fontSize: toolbar.getFontSize(),
  lineWidth: toolbar.getLineWidth(),
});

const canvasView = new CircularCanvas(canvasPanel, store, getToolState);
const archiveView = new ArchiveView(archivePanel, primarySlot, store);
// SMUI（眼鏡デュアルビュー）: 旧「共有」タブを置き換える。左レンズは通常キャンバスと
// 同じ個人MemoStore（store）をそのまま表示・編集し、右レンズが選んだ共有キャンバスを扱う。
// フレーム形状（丸眼鏡/楕円/長方形）とルームの作成・選択は、このビュー自身ではなく
// 下の操作パネル（FrameShapeSelector）とヘッダー（SharedRoomMenu）が持つ
// （ユーザー指示：レンズは表示に専念させ、操作の置き場所を分ける）。
let frameShapeId = loadFrameShape();
const smuiView = new SmuiView(sharedPanel, store, getToolState, frameShapeId);
const toolbarEl = primarySlot.querySelector<HTMLElement>(".toolbar")!;

// 画面切り替え時、道具バー・時間選択ブロックをふわっとフェードイン／
// フェードアウトさせる（archiveViewのシークバーも同じ仕組み。ユーザー指示）。
const setToolbarVisible = createFadeVisibility(toolbarEl);
const setDurationVisible = createFadeVisibility(durationSlot);
const setFrameShapeVisible = createFadeVisibility(frameShapeSlot);
const setSharedRoomMenuVisible = createFadeVisibility(sharedRoomMenuSlot);
// 初期表示（キャンバス）ではフェードインさせず、最初から見えている状態にする。
toolbarEl.classList.add("is-visible");
durationSlot.classList.add("is-visible");

new FrameShapeSelector(frameShapeSlot, frameShapeId, (id) => {
  frameShapeId = id;
  saveFrameShape(id);
  smuiView.setFrameShape(id);
});

// 共有キャンバス（ルーム）の作成・選択・招待リンクのメニュー。「共有」タブを
// 見ているときだけヘッダーに表示する（ユーザー指示）。招待リンク経由の
// 自動参加（?join=...）はタブの表示状態と無関係に裏で動くため、ボタン自体は
// 常に生成しておく（隠すのは見た目=hidden属性だけ）。
new SharedRoomMenu(
  sharedRoomMenuSlot,
  (id) => void smuiView.selectRoom(id),
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
  canvasPanel.hidden = view !== "canvas";
  archivePanel.hidden = view !== "archive";
  sharedPanel.hidden = view !== "shared";
  document.querySelectorAll<HTMLButtonElement>(".view-nav-btn").forEach((btn) => {
    btn.style.opacity = btn.dataset.view === view ? "1" : "0.45";
  });

  // まず今表示している下部バー・ヘッダーの中身を丸ごとフェードアウトさせる。
  setToolbarVisible(false);
  setDurationVisible(false);
  setFrameShapeVisible(false);
  setSharedRoomMenuVisible(false);
  archiveView.setActive(false);
  smuiView.setActive(false);

  window.setTimeout(() => {
    // フェードアウト待ちの間にさらに別の画面へ切り替えられていた場合は、
    // 古い方のフェードインは行わない（最後に呼ばれた切り替えだけを反映する）。
    if (currentView !== view) return;
    // 道具バーはキャンバス表示中に加え、SMUI（共有）の左右レンズでも描画に
    // 使うため表示する。時間選択ブロック（DurationSelector）は振り返り中は
    // そのシークバーが#primary-slotを占有するため両方とも表示しない。
    setToolbarVisible(view === "canvas" || view === "shared");
    setDurationVisible(view === "canvas" || view === "shared");
    // フレーム形状セレクタ・共有ルームメニューはSMUI（共有）表示中だけ意味を
    // 持つため、他の2画面では出さない（ユーザー指示）。
    setFrameShapeVisible(view === "shared");
    setSharedRoomMenuVisible(view === "shared");
    archiveView.setActive(view === "archive");
    smuiView.setActive(view === "shared");
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
  if (currentView === "canvas") canvasView.render(now);
  if (changed && currentView === "archive") archiveView.render();
  if (currentView === "shared") smuiView.render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
