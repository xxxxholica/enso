import { onUserChange } from "./authState";
import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { getNickname, setNickname } from "./sharedCanvasNicknames";
import {
  createSharedCanvas,
  joinSharedCanvas,
  listSharedCanvases,
  type SharedCanvasSummary,
} from "./sharedCanvas";

const JOIN_PARAM = "join";
const CREATE_LABEL = "+ 新しい共有キャンバスを作る";
const COPY_LABEL = "コピー";

/**
 * 眼鏡キャンバスの下（smuiView.getRoomMenuSlot()）に置く、共有キャンバス
 * （ルーム）の作成・選択・招待リンクのポップアップメニュー。キャンバス自体は
 * 「選んだルームのキャンバス」だけを表示するようにし、ルームの作成・切り替え
 * という操作はここに切り出してある。
 *
 * 実際にどのルームを表示するかは、選択結果をコールバック（onSelectRoom）で
 * SmuiView.selectRoom()へ渡すだけで、このクラス自身はキャンバスの中身を
 * 一切扱わない。ポップアップの開閉は道具バーのテンプレート選択（toolbar.ts の
 * buildTemplateControl）と同じ .icon-anchor/.icon-popover パターンをそのまま
 * 使う——ボタンが画面下寄りにあるため、既定の上向きに開けば画面内に収まる。
 */
export class SharedRoomMenu {
  private onSelectRoom: (id: string) => void;
  private onAutoOpen: () => void;
  private pendingJoinId: string | null;
  private signedIn = false;
  private busy = false;
  private open = false;
  private readonly closeRef = () => this.close();

  private btn!: HTMLButtonElement;
  private popover!: HTMLElement;
  private popoverFade!: (show: boolean) => void;
  private signedOutEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private createBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private inviteInput!: HTMLInputElement;
  private copyBtn!: HTMLButtonElement;
  private roomListEl!: HTMLUListElement;
  private emptyEl!: HTMLElement;
  private copyFeedbackTimer: number | undefined;

  private rooms: SharedCanvasSummary[] = [];
  private selectedId: string | null = null;

  constructor(container: HTMLElement, onSelectRoom: (id: string) => void, onAutoOpen: () => void) {
    this.onSelectRoom = onSelectRoom;
    this.onAutoOpen = onAutoOpen;
    this.pendingJoinId = new URLSearchParams(location.search).get(JOIN_PARAM);

    this.buildDom(container);
    this.updateTriggerLabel();

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

    // 以前はアイコンのみのボタンだったが、何のボタンか一目で分かりにくかった
    // （ユーザー指摘）ため、文字を持たせる——未接続時は「＋ルームを作成」、
    // ルーム接続中はそのルームIDの先頭7文字（一覧のbtn.titleと同じ考え方で
    // フルIDはtitle属性に持たせる）を表示する。
    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "pill-btn shared-room-trigger";
    this.btn.setAttribute("aria-label", "共有キャンバスの作成・選択");
    this.btn.addEventListener("click", () => this.toggle());
    anchor.appendChild(this.btn);

    this.popover = document.createElement("div");
    // ボタンが眼鏡キャンバスの下（画面下寄り）に置かれるようになったため、
    // 下向き(icon-popover--below)ではなく既定の上向き（道具バーのテンプレート
    // メニューと同じ）に開く——下向きのままだと画面外にはみ出してしまう
    // （ユーザー指摘）。
    this.popover.className = "shared-room-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    this.signedOutEl = document.createElement("p");
    this.signedOutEl.className = "shared-signedout";
    this.signedOutEl.textContent = "共有キャンバスを使うには、右上からログインしてください。";
    this.popover.appendChild(this.signedOutEl);

    this.mainEl = document.createElement("div");
    this.mainEl.className = "shared-room-menu-main";
    this.mainEl.hidden = true;

    // 3つの区画（作成／招待リンク／ルーム一覧）を.shared-menu-sectionで区切り、
    // 同じカードの中でも役割の境目が見えるようにする（ユーザー指摘：色々な
    // 要素が区切りなく1枚に同居している）。
    const createSection = document.createElement("div");
    createSection.className = "shared-menu-section";
    this.createBtn = document.createElement("button");
    this.createBtn.type = "button";
    this.createBtn.className = "pill-btn";
    this.createBtn.textContent = CREATE_LABEL;
    this.createBtn.addEventListener("click", () => void this.handleCreate());
    createSection.appendChild(this.createBtn);
    // ここには成功メッセージ（「作成しました」等）は出さない——招待リンクが
    // 現れること自体が成功の合図になるため、専用の1行を使ってまで知らせる
    // 必要がない（ユーザー指摘：無駄な表示で1行使わない）。エラーと、
    // ボタンを持たない自動参加中の一時的な状態表示だけをここに出す。
    this.statusEl = document.createElement("p");
    this.statusEl.className = "shared-status";
    createSection.appendChild(this.statusEl);
    this.mainEl.appendChild(createSection);

    const inviteSection = document.createElement("div");
    inviteSection.className = "shared-menu-section";
    const inviteRow = document.createElement("div");
    inviteRow.className = "shared-invite";
    const inviteLabel = document.createElement("div");
    inviteLabel.className = "shared-section-label";
    inviteLabel.textContent = "招待リンク";
    inviteRow.appendChild(inviteLabel);
    // 入力欄＋コピーは見出し行と分け、この2つだけの行にする——招待リンク:
    // ラベルまで同じ行に入れていた以前は、狭い幅でコピーボタンが弾かれて
    // 次の行に落ちてしまっていた（ユーザー指摘：1行で表示すべき）。
    const inviteInputRow = document.createElement("div");
    inviteInputRow.className = "shared-invite-input-row";
    this.inviteInput = document.createElement("input");
    this.inviteInput.className = "shared-invite-input";
    this.inviteInput.readOnly = true;
    // ルームを選ぶまでは行自体を隠すのではなく、disabled・薄い表示のまま
    // 常に出しておく（ユーザー指摘：どこに出るか事前に分かるようにしたい）。
    this.inviteInput.disabled = true;
    this.inviteInput.placeholder = "ルームを作成・選択すると表示されます";
    this.inviteInput.addEventListener("focus", () => this.inviteInput.select());
    inviteInputRow.appendChild(this.inviteInput);
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className = "pill-btn";
    this.copyBtn.textContent = COPY_LABEL;
    this.copyBtn.disabled = true;
    this.copyBtn.addEventListener("click", () => void this.copyInviteLink());
    inviteInputRow.appendChild(this.copyBtn);
    inviteRow.appendChild(inviteInputRow);
    inviteSection.appendChild(inviteRow);
    this.mainEl.appendChild(inviteSection);

    const listSection = document.createElement("div");
    listSection.className = "shared-menu-section";
    const listLabel = document.createElement("div");
    listLabel.className = "shared-section-label";
    listLabel.textContent = "参加中のルーム";
    listSection.appendChild(listLabel);

    this.roomListEl = document.createElement("ul");
    this.roomListEl.className = "shared-room-list";
    listSection.appendChild(this.roomListEl);

    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "archive-empty";
    this.emptyEl.textContent = "参加中の共有キャンバスがありません。作成するか、招待リンクから参加してください。";
    this.emptyEl.hidden = true;
    listSection.appendChild(this.emptyEl);

    const roomHint = document.createElement("p");
    roomHint.className = "shared-room-hint";
    roomHint.textContent = "名前はこの端末だけに表示されます(他の参加者には見えません)。";
    listSection.appendChild(roomHint);

    this.mainEl.appendChild(listSection);

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
    notifyOpen(this.closeRef);
    this.open = true;
    this.btn.dataset.active = "true";
    this.popoverFade(true);
    if (this.signedIn) void this.refreshRoomList();
    // 招待リンクは作成直後だけでなく、今選んでいるルームがあれば開くたびに
    // 出す（ユーザー指摘：作成直後しか出てこないのは不便）。
    if (this.selectedId) this.showInviteLink(this.selectedId);
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.btn.dataset.active = "false";
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private clearJoinParam(): void {
    const url = new URL(location.href);
    url.searchParams.delete(JOIN_PARAM);
    history.replaceState(null, "", url);
  }

  /** トリガーボタンの文字を今の状態に合わせる：未接続なら「＋ルームを作成」、
   *  接続中ならそのルームIDの先頭7文字（フルIDはtitle属性に持たせる）。 */
  private updateTriggerLabel(): void {
    if (this.selectedId) {
      this.btn.textContent = this.selectedId.slice(0, 7);
      this.btn.title = this.selectedId;
    } else {
      this.btn.textContent = "＋ルームを作成";
      this.btn.title = "";
    }
  }

  /** 指定したルームへの招待リンクを組み立てて表示する。ルームIDさえあれば
   *  決定的に作れる（サーバー問い合わせ不要）ため、作成直後だけでなく、
   *  一覧から既存ルームを選んだとき・メニューを開き直したときにも呼べる。 */
  private showInviteLink(id: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(JOIN_PARAM, id);
    this.inviteInput.value = url.toString();
    this.inviteInput.disabled = false;
    this.copyBtn.disabled = false;
  }

  private async handleSignedIn(): Promise<void> {
    if (this.pendingJoinId) {
      const id = this.pendingJoinId;
      this.pendingJoinId = null;
      this.clearJoinParam();
      // 自動参加はボタンを押す操作を経ないため、進行中を示す手段がここしか
      // ない（作成・コピーはボタン自身の文字を差し替えるだけで済ませている
      // のと対照的）。成功時は招待リンクが現れる・ルームが選ばれた状態に
      // なること自体が合図になるので、成功メッセージは出さずすぐ消す。
      this.setStatus("参加しています…");
      try {
        await joinSharedCanvas(id);
        await this.refreshRoomList();
        this.selectedId = id;
        this.updateTriggerLabel();
        this.renderRoomList();
        this.onSelectRoom(id);
        this.showInviteLink(id);
        this.setStatus("");
        this.onAutoOpen();
      } catch (e) {
        this.setStatus(e instanceof Error ? e.message : "参加に失敗しました");
      }
    }
  }

  private async handleCreate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus("");
    this.createBtn.disabled = true;
    this.createBtn.textContent = "作成中…";
    try {
      const id = await createSharedCanvas();
      await this.refreshRoomList();
      this.selectedId = id;
      this.updateTriggerLabel();
      this.renderRoomList();
      this.onSelectRoom(id);
      // 成功メッセージは出さない——招待リンクが現れて一覧に新しいルームが
      // 選択状態で並ぶこと自体が「できた」の合図になる（ユーザー指摘：
      // 無駄な表示で1行使わない）。
      this.showInviteLink(id);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      this.busy = false;
      this.createBtn.disabled = false;
      this.createBtn.textContent = CREATE_LABEL;
    }
  }

  /** コピーの成否は、別行のステータス文字ではなくボタン自身の文字を
   *  一瞬だけ差し替えて伝える（ユーザー指摘：無駄な表示で1行使わない）。
   *  失敗時だけは操作のやり直し方（選択してコピー）を説明する必要がある
   *  ため、従来通りstatusEl（エラー用）に出す。 */
  private async copyInviteLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteInput.value);
      this.flashCopyButton("コピーしました");
    } catch {
      this.inviteInput.select();
      this.setStatus("コピーできませんでした。選択してご自身でコピーしてください");
    }
  }

  private flashCopyButton(text: string): void {
    window.clearTimeout(this.copyFeedbackTimer);
    this.copyBtn.textContent = text;
    this.copyFeedbackTimer = window.setTimeout(() => {
      this.copyBtn.textContent = COPY_LABEL;
    }, 1500);
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
      btn.className = "pill-btn shared-room-btn";
      btn.textContent = getNickname(room.id) ?? `${room.id.slice(0, 8)}…`;
      btn.title = room.id;
      btn.setAttribute("aria-pressed", String(room.id === this.selectedId));
      btn.addEventListener("click", () => {
        this.selectedId = room.id;
        this.updateTriggerLabel();
        this.renderRoomList();
        this.onSelectRoom(room.id);
        this.showInviteLink(room.id);
        this.close();
      });
      li.appendChild(btn);

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "text-link shared-room-rename";
      renameBtn.textContent = "名前を変更";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startRename(li, room.id);
      });
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
}
