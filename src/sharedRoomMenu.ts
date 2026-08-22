import { onUserChange } from "./authState";
import { createFadeVisibility } from "./fadeVisibility";
import { ICONS } from "./icons";
import {
  createSharedCanvas,
  joinSharedCanvas,
  listSharedCanvases,
  type SharedCanvasSummary,
} from "./sharedCanvas";

const JOIN_PARAM = "join";

/**
 * ヘッダー（アカウント表示の右）に置く、共有キャンバス（ルーム）の作成・選択・
 * 招待リンクのポップアップメニュー。以前はSMUIの右レンズ周辺にこのUI一式が
 * 直接置かれていたが、レンズ自体は「選んだルームのキャンバス」だけを表示する
 * ようにし、ルームの作成・切り替えという操作はここに切り出した。
 *
 * 実際にどのルームを表示するかは、選択結果をコールバック（onSelectRoom）で
 * SmuiView.selectRoom()へ渡すだけで、このクラス自身はキャンバスの中身を
 * 一切扱わない。ポップアップの開閉は道具バーのテンプレート選択（toolbar.ts の
 * buildTemplateControl）と同じ .icon-anchor/.icon-popover パターンを流用するが、
 * ヘッダー（画面上部）に置くため下ではなく上に開く向きだけ変える
 * （.icon-popover--below）。
 */
export class SharedRoomMenu {
  private onSelectRoom: (id: string) => void;
  private onAutoOpen: () => void;
  private pendingJoinId: string | null;
  private signedIn = false;
  private busy = false;
  private open = false;

  private btn!: HTMLButtonElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private signedOutEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private inviteRow!: HTMLElement;
  private inviteInput!: HTMLInputElement;
  private roomListEl!: HTMLUListElement;
  private emptyEl!: HTMLElement;

  private rooms: SharedCanvasSummary[] = [];
  private selectedId: string | null = null;

  constructor(container: HTMLElement, onSelectRoom: (id: string) => void, onAutoOpen: () => void) {
    this.onSelectRoom = onSelectRoom;
    this.onAutoOpen = onAutoOpen;
    this.pendingJoinId = new URLSearchParams(location.search).get(JOIN_PARAM);

    this.buildDom(container);

    onUserChange((user) => {
      const wasSignedIn = this.signedIn;
      this.signedIn = user !== null;
      this.signedOutEl.hidden = this.signedIn;
      this.mainEl.hidden = !this.signedIn;
      if (this.signedIn && !wasSignedIn) void this.handleSignedIn();
    });
  }

  private buildDom(container: HTMLElement): void {
    const anchor = document.createElement("div");
    anchor.className = "icon-anchor";

    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "toolbar-btn";
    this.btn.setAttribute("aria-label", "共有キャンバスの作成・選択");
    this.btn.innerHTML = ICONS.sharedRooms;
    this.btn.addEventListener("click", () => this.toggle());
    anchor.appendChild(this.btn);

    this.popover = document.createElement("div");
    this.popover.className = "shared-room-popover icon-popover icon-popover--below icon-popover--align-end";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.signedOutEl = document.createElement("p");
    this.signedOutEl.className = "shared-signedout";
    this.signedOutEl.textContent = "共有キャンバスを使うには、右上からログインしてください。";
    this.popover.appendChild(this.signedOutEl);

    this.mainEl = document.createElement("div");
    this.mainEl.className = "shared-room-menu-main";
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

    this.roomListEl = document.createElement("ul");
    this.roomListEl.className = "shared-room-list";
    this.mainEl.appendChild(this.roomListEl);

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "archive-empty";
    this.emptyEl.textContent = "参加中の共有キャンバスがありません。作成するか、招待リンクから参加してください。";
    this.emptyEl.hidden = true;
    this.mainEl.appendChild(this.emptyEl);

    this.popover.appendChild(this.mainEl);
    anchor.appendChild(this.popover);
    container.appendChild(anchor);
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    this.open = true;
    this.btn.dataset.active = "true";
    this.popoverFade(true);
    if (this.signedIn) void this.refreshRoomList();
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.btn.dataset.active = "false";
    this.popoverFade(false);
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
        this.selectedId = id;
        this.renderRoomList();
        this.onSelectRoom(id);
        this.setStatus("参加しました");
        this.onAutoOpen();
      } catch (e) {
        this.setStatus(e instanceof Error ? e.message : "参加に失敗しました");
      }
    }
  }

  private async handleCreate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus("作成中…");
    try {
      const id = await createSharedCanvas();
      await this.refreshRoomList();
      this.selectedId = id;
      this.renderRoomList();
      this.onSelectRoom(id);
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-link shared-room-btn";
      btn.textContent = `${room.id.slice(0, 8)}…`;
      btn.title = room.id;
      btn.setAttribute("aria-pressed", String(room.id === this.selectedId));
      btn.addEventListener("click", () => {
        this.selectedId = room.id;
        this.renderRoomList();
        this.onSelectRoom(room.id);
        this.close();
      });
      li.appendChild(btn);
      this.roomListEl.appendChild(li);
    }
  }
}
