import { onUserChange } from "./authState";
import { fitCanvasToContainer } from "./canvasSizing";
import { computeOpacity } from "./fade";
import { renderMemoAt } from "./memoRenderer";
import { drawRuledPaper } from "./paper";
import { getNickname, setNickname } from "./sharedCanvasNicknames";
import {
  createSharedCanvas,
  getSharedCanvas,
  joinSharedCanvas,
  listSharedCanvases,
  type SharedCanvasSummary,
} from "./sharedCanvas";
import type { Memo } from "./types";

const CIRCLE_BORDER = "oklch(22% 0.012 55 / 0.08)";
const JOIN_PARAM = "join";

/**
 * 共有キャンバス（コラボ機能Lv1）: 作成・招待リンクでの参加・一覧・閲覧だけを行う。
 * 書き込み（PUT）はまだ実装しない——見るだけの画面。
 * 通常キャンバスと同じ大きさの円を、同じ描画部品（drawRuledPaper/renderMemoAt）で
 * 静的に（自分では触れず）表示する。
 */
export class SharedCanvasView {
  private container: HTMLElement;
  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private onAutoOpen: () => void;
  private pendingJoinId: string | null;
  private signedIn = false;
  private active = false;
  private busy = false;

  private signedOutEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inviteRow!: HTMLElement;
  private inviteInput!: HTMLInputElement;
  private roomListEl!: HTMLUListElement;
  private canvasWrap!: HTMLElement;
  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  private emptyEl!: HTMLElement;

  private rooms: SharedCanvasSummary[] = [];
  private selectedId: string | null = null;
  private selectedMemos: Memo[] = [];
  private radius = 0;
  private size = 0;

  constructor(container: HTMLElement, onAutoOpen: () => void) {
    this.container = container;
    this.onAutoOpen = onAutoOpen;
    this.pendingJoinId = new URLSearchParams(location.search).get(JOIN_PARAM);
    this.buildDom();

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.canvasWrap);

    onUserChange((user) => {
      const wasSignedIn = this.signedIn;
      this.signedIn = user !== null;
      this.signedOutEl.hidden = this.signedIn;
      this.mainEl.hidden = !this.signedIn;
      if (this.signedIn && !wasSignedIn) void this.handleSignedIn();
    });
  }

  private buildDom(): void {
    const view = document.createElement("div");
    view.className = "shared-view";

    this.signedOutEl = document.createElement("p");
    this.signedOutEl.className = "shared-signedout";
    this.signedOutEl.textContent = "共有キャンバスを使うには、右上からログインしてください。";
    view.appendChild(this.signedOutEl);

    this.mainEl = document.createElement("div");
    this.mainEl.className = "shared-main";
    this.mainEl.hidden = true;

    const toolbar = document.createElement("div");
    toolbar.className = "shared-toolbar";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "text-link";
    createBtn.textContent = "+ 新しい共有キャンバスを作る";
    createBtn.addEventListener("click", () => void this.handleCreate());
    toolbar.appendChild(createBtn);
    this.statusEl = document.createElement("span");
    this.statusEl.className = "shared-status";
    toolbar.appendChild(this.statusEl);
    this.mainEl.appendChild(toolbar);

    this.inviteRow = document.createElement("div");
    this.inviteRow.className = "shared-invite";
    this.inviteRow.hidden = true;
    const inviteLabel = document.createElement("span");
    inviteLabel.textContent = "招待リンク:";
    this.inviteRow.appendChild(inviteLabel);
    this.inviteInput = document.createElement("input");
    this.inviteInput.className = "shared-invite-input";
    this.inviteInput.readOnly = true;
    this.inviteInput.addEventListener("focus", () => this.inviteInput.select());
    this.inviteRow.appendChild(this.inviteInput);
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "text-link";
    copyBtn.textContent = "コピー";
    copyBtn.addEventListener("click", () => void this.copyInviteLink());
    this.inviteRow.appendChild(copyBtn);
    this.mainEl.appendChild(this.inviteRow);

    const body = document.createElement("div");
    body.className = "shared-body";

    const roomPanel = document.createElement("div");
    roomPanel.className = "shared-room-panel";

    this.roomListEl = document.createElement("ul");
    this.roomListEl.className = "shared-room-list";
    roomPanel.appendChild(this.roomListEl);

    const roomHint = document.createElement("p");
    roomHint.className = "shared-room-hint";
    roomHint.textContent = "名前はこの端末だけに表示されます(他の参加者には見えません)。";
    roomPanel.appendChild(roomHint);

    body.appendChild(roomPanel);

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "archive-canvas-wrap shared-canvas-wrap";
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.className = "archive-preview";
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is not available");
    this.previewCtx = ctx;
    this.canvasWrap.appendChild(this.previewCanvas);
    body.appendChild(this.canvasWrap);

    this.mainEl.appendChild(body);

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "archive-empty";
    this.emptyEl.textContent = "参加中の共有キャンバスがありません。作成するか、招待リンクから参加してください。";
    this.emptyEl.hidden = true;
    this.mainEl.appendChild(this.emptyEl);

    view.appendChild(this.mainEl);
    this.container.appendChild(view);
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private clearJoinParam(): void {
    const url = new URL(location.href);
    url.searchParams.delete(JOIN_PARAM);
    history.replaceState(null, "", url);
  }

  private async handleSignedIn(): Promise<void> {
    if (this.pendingJoinId) {
      const id = this.pendingJoinId;
      this.pendingJoinId = null;
      this.clearJoinParam();
      this.setStatus("参加しています…");
      try {
        await joinSharedCanvas(id);
        await this.refreshRoomList();
        await this.selectRoom(id);
        this.setStatus("参加しました");
        this.onAutoOpen();
      } catch (e) {
        this.setStatus(e instanceof Error ? e.message : "参加に失敗しました");
      }
      return;
    }
    if (this.active) void this.refreshRoomList();
  }

  private async handleCreate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus("作成中…");
    try {
      const id = await createSharedCanvas();
      await this.refreshRoomList();
      await this.selectRoom(id);
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set(JOIN_PARAM, id);
      this.inviteInput.value = url.toString();
      this.inviteRow.hidden = false;
      this.setStatus("作成しました");
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      this.busy = false;
    }
  }

  private async copyInviteLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteInput.value);
      this.setStatus("リンクをコピーしました");
    } catch {
      this.inviteInput.select();
      this.setStatus("コピーできませんでした。選択してご自身でコピーしてください");
    }
  }

  private async refreshRoomList(): Promise<void> {
    try {
      this.rooms = await listSharedCanvases();
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "一覧の取得に失敗しました");
      this.rooms = [];
    }
    this.renderRoomList();
  }

  private renderRoomList(): void {
    this.roomListEl.innerHTML = "";
    this.emptyEl.hidden = this.rooms.length > 0;
    for (const room of this.rooms) {
      const li = document.createElement("li");
      li.className = "shared-room-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-link shared-room-btn";
      btn.textContent = getNickname(room.id) ?? room.id;
      btn.setAttribute("aria-pressed", String(room.id === this.selectedId));
      btn.addEventListener("click", () => void this.selectRoom(room.id));
      li.appendChild(btn);

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "text-link shared-room-rename";
      renameBtn.textContent = "名前を変更";
      renameBtn.addEventListener("click", () => this.startRename(li, room.id));
      li.appendChild(renameBtn);

      this.roomListEl.appendChild(li);
    }
  }

  /** ルーム項目の名前ボタンを、blurで確定・Escapeでキャンセルする入力欄に一時的に置き換える。 */
  private startRename(li: HTMLLIElement, id: string): void {
    const labelBtn = li.querySelector<HTMLButtonElement>(".shared-room-btn");
    if (!labelBtn) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "shared-room-rename-input";
    input.value = getNickname(id) ?? id;
    labelBtn.replaceWith(input);
    input.focus();
    input.select();

    let cancelled = false;
    input.addEventListener("blur", () => {
      if (!cancelled) setNickname(id, input.value);
      this.renderRoomList();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        cancelled = true;
        input.blur();
      }
    });
  }

  private async selectRoom(id: string): Promise<void> {
    this.selectedId = id;
    this.renderRoomList();
    this.setStatus("読み込み中…");
    try {
      const detail = await getSharedCanvas(id);
      this.selectedMemos = detail.memos;
      this.setStatus("");
    } catch (e) {
      this.selectedMemos = [];
      this.setStatus(e instanceof Error ? e.message : "取得に失敗しました");
    }
    this.render(Date.now());
  }

  /** 表示中かどうかにかかわらず呼んでよい。 */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.resize();
      if (this.signedIn) void this.refreshRoomList();
    }
  }

  private resize(): void {
    const { scale, width } = fitCanvasToContainer(this.previewCanvas, this.canvasWrap, this.dpr);
    this.radius = scale;
    this.size = width;
    this.render(Date.now());
  }

  /** 選択中の共有キャンバスを現在時刻の不透明度で描き直す。フェード表現を通常キャンバスと揃える。 */
  render(now: number): void {
    if (!this.active || this.radius === 0) return;
    const ctx = this.previewCtx;
    const size = this.size;
    const cx = size / 2;
    const cy = size / 2;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = CIRCLE_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);

    drawRuledPaper(ctx, this.radius);

    for (const memo of this.selectedMemos) {
      if (memo.status !== "active") continue;
      const opacity = computeOpacity(now - memo.lastTracedAt, memo.lifespanDays);
      if (opacity <= 0) continue;
      renderMemoAt(ctx, memo, this.radius, opacity);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.restore(); // clip
    ctx.restore(); // setTransform
  }
}
