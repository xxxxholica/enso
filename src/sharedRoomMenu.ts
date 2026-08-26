import { onUserChange } from "./authState";
import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import {
  createSharedCanvas,
  getSharedCanvas,
  joinSharedCanvas,
  leaveSharedCanvas,
  listSharedCanvases,
  renameSharedCanvas,
  type SharedCanvasSummary,
} from "./sharedCanvas";

const JOIN_PARAM = "join";
const CREATE_LABEL = "+ 新しい共有キャンバスを作る";
const COPY_LABEL = "コピー";

/** ルーム一覧の各項目に添えるステータス。一覧取得API(listSharedCanvases)は
 *  セッション状態を返さないため、行ごとに個別にgetSharedCanvas(id)を叩いて
 *  判定する（issue #79：一覧でも進行中/終了が分かるようにしたいというユーザー指示）。
 *  - active: セッション進行中(session !== null)
 *  - ended: セッションは今動いていないが、確定済み(fadeExempt)のメモが残っている
 *    ＝過去にセッションを実施済み
 *  - not-started: セッションを一度も実施していない */
type RoomStatus = "active" | "ended" | "not-started";
const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  active: "進行中",
  ended: "終了",
  "not-started": "未実施",
};

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

  private anchor!: HTMLElement;
  private btn!: HTMLButtonElement;
  private btnIconEl!: HTMLElement;
  private btnLabelEl!: HTMLElement;
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
  /** ルームIDごとのステータス取得結果のキャッシュ。refreshRoomList()の
   *  たびにクリアし、開き直すたびに最新の状態を取り直す。 */
  private roomStatus = new Map<string, RoomStatus>();
  /** 非同期で届いたステータスを、再描画済みの最新のDOM要素へ正しく反映する
   *  ための対応表（renderRoomList()のたびに作り直す）。 */
  private roomStatusBadgeEls = new Map<string, HTMLElement>();

  /** ルームごとの「その他の操作」メニュー（今は「名前を変更」の1件のみ、
   *  今後増える操作もここに並べていく想定）。同時に1つしか開かない。 */
  private roomActionsMenuEl: HTMLElement | null = null;
  private roomActionsMenuCleanup: (() => void) | null = null;

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
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    // 以前はアイコンのみのボタンだったが、何のボタンか一目で分かりにくかった
    // （ユーザー指摘）ため、文字を持たせる——未接続時は「＋ルームを作成」、
    // ルーム接続中はそのルームIDの先頭7文字（一覧のbtn.titleと同じ考え方で
    // フルIDはtitle属性に持たせる）を表示する。
    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "pill-btn shared-room-trigger";
    this.btn.setAttribute("aria-label", "共有キャンバスの作成・選択");
    this.btn.addEventListener("click", () => this.toggle());
    // ルーム接続中は家のアイコンを添える——IDの文字列だけだと何のボタンか
    // 分かりにくい（ユーザー指摘）。未接続の「＋ルームを作成」は文字だけで
    // 自明なため、アイコンはupdateTriggerLabelで接続中だけ表示する。
    this.btnIconEl = document.createElement("span");
    this.btnIconEl.className = "shared-room-trigger-icon";
    this.btnIconEl.innerHTML = ICONS.room;
    this.btn.appendChild(this.btnIconEl);
    this.btnLabelEl = document.createElement("span");
    this.btn.appendChild(this.btnLabelEl);
    this.anchor.appendChild(this.btn);

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
    this.createBtn.className = "pill-btn pill-btn--primary";
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

    this.mainEl.appendChild(listSection);

    this.popover.appendChild(this.mainEl);
    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    notifyOpen(this.closeRef, this.anchor);
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
    this.closeRoomActionsMenu();
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
      this.btnIconEl.hidden = false;
      this.btnLabelEl.textContent = this.selectedId.slice(0, 7);
      this.btn.title = this.selectedId;
    } else {
      this.btnIconEl.hidden = true;
      this.btnLabelEl.textContent = "＋ルームを作成";
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
      // ポップオーバーを開いておかないとこのstatusEl自体が(hidden内なので)
      // 見えず、失敗した時にも無言のまま終わってしまう——実際に招待リンク
      // 経由の自動参加が失敗しても気付けなかった不具合があったため。
      this.openMenu();
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
        // 成功時は「共有」タブに切り替わったこと自体が合図になるので、
        // ポップオーバーは開けたままにしない（ユーザー指摘：開きっぱなしは
        // 邪魔）。失敗時は原因が読めるよう、閉じずに残す。
        this.close();
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
    // 開き直すたびに最新のステータスを取り直す（進行中→終了等の変化を拾うため）。
    this.roomStatus.clear();
    this.renderRoomList();
  }

  /** 1ルームぶんのステータスを取得し、そのルームの行がまだ表示中であれば
   *  バッジへ反映する。一覧の行を再構築するのではなく該当バッジだけを
   *  差し替えるため、他の行の表示（リネーム中の入力欄等）を巻き込まない。 */
  private async loadRoomStatus(id: string): Promise<void> {
    let status: RoomStatus;
    try {
      const detail = await getSharedCanvas(id);
      status = detail.session ? "active" : detail.memos.some((m) => m.fadeExempt) ? "ended" : "not-started";
    } catch {
      return; // 取得できなければバッジ無しのまま（一覧自体の表示は既に済んでいるため致命的ではない）
    }
    this.roomStatus.set(id, status);
    const badge = this.roomStatusBadgeEls.get(id);
    if (badge) this.applyRoomStatusBadge(badge, status);
  }

  private applyRoomStatusBadge(el: HTMLElement, status: RoomStatus | undefined): void {
    if (!status) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = ROOM_STATUS_LABEL[status];
    el.dataset.status = status;
  }

  /** ルームの行は[ルーム名(操作トリガー付き)][退出]の2要素だけに絞る
   *  （ユーザー指示：認知負荷を下げたい）。「名前を変更」は常時表示のボタンではなく、
   *  ルーム名にホバー（PC）／長押し（タッチ）したときだけ開く操作メニューに
   *  格上げする——ホバーしただけでは確定せず、メニューから選んで初めて実行される。 */
  private renderRoomList(): void {
    this.closeRoomActionsMenu();
    this.roomListEl.innerHTML = "";
    this.roomStatusBadgeEls.clear();
    this.emptyEl.hidden = this.rooms.length > 0;
    for (const room of this.rooms) {
      const li = document.createElement("li");
      li.className = "shared-room-item";

      const nameWrap = document.createElement("div");
      nameWrap.className = "shared-room-name-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-btn shared-room-btn";
      const label = room.name ?? `${room.id.slice(0, 8)}…`;
      btn.textContent = label;
      // 長い名前は.shared-room-btnのCSSで省略表示(…)されるため、
      // titleは表示中のラベル自体にしてホバーで全文を確認できるようにする。
      btn.title = label;
      btn.setAttribute("aria-pressed", String(room.id === this.selectedId));
      nameWrap.appendChild(btn);

      const statusBadge = document.createElement("span");
      statusBadge.className = "shared-room-status-badge";
      this.applyRoomStatusBadge(statusBadge, this.roomStatus.get(room.id));
      this.roomStatusBadgeEls.set(room.id, statusBadge);
      nameWrap.appendChild(statusBadge);
      if (!this.roomStatus.has(room.id)) void this.loadRoomStatus(room.id);

      const actionsBtn = document.createElement("button");
      actionsBtn.type = "button";
      actionsBtn.className = "shared-room-actions-trigger";
      actionsBtn.setAttribute("aria-label", "ルームの操作メニュー");
      actionsBtn.innerHTML = ICONS.moreActions;
      actionsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openRoomActionsMenu(actionsBtn, li, room);
      });
      nameWrap.appendChild(actionsBtn);

      const selectRoom = () => {
        this.selectedId = room.id;
        this.updateTriggerLabel();
        this.renderRoomList();
        this.onSelectRoom(room.id);
        this.showInviteLink(room.id);
        this.close();
      };
      this.attachRoomNamePress(btn, actionsBtn, li, room, selectRoom);

      li.appendChild(nameWrap);

      const leaveBtn = document.createElement("button");
      leaveBtn.type = "button";
      leaveBtn.className = "pill-btn shared-room-leave";
      leaveBtn.textContent = "退出";
      leaveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.handleLeave(room.id, label, leaveBtn);
      });
      li.appendChild(leaveBtn);

      this.roomListEl.appendChild(li);
    }
  }

  /** ルーム名ボタンの押し方を、マウスは通常クリック（＝選択）、タッチ／ペンは
   *  長押しで操作メニューを開く・短いタップで選択、の2通りに振り分ける
   *  （ユーザー指示：タッチでは長押しでメニューを開けるようにしたい）。
   *  マウスは:hoverで見える「…」アイコン（openRoomActionsMenu）から開くため、
   *  ここでは長押し扱いにしない。 */
  private attachRoomNamePress(
    btn: HTMLButtonElement,
    actionsBtn: HTMLButtonElement,
    li: HTMLLIElement,
    room: SharedCanvasSummary,
    selectRoom: () => void
  ): void {
    const LONG_PRESS_MS = 500;
    const MOVE_CANCEL_PX = 10;
    let timer: number | undefined;
    let longPressed = false;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    btn.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse") return;
      longPressed = false;
      startX = ev.clientX;
      startY = ev.clientY;
      clearTimer();
      timer = window.setTimeout(() => {
        longPressed = true;
        this.openRoomActionsMenu(actionsBtn, li, room);
      }, LONG_PRESS_MS);
    });
    btn.addEventListener("pointermove", (ev) => {
      if (timer === undefined) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_CANCEL_PX) clearTimer();
    });
    btn.addEventListener("pointerup", clearTimer);
    btn.addEventListener("pointercancel", clearTimer);
    btn.addEventListener("click", (ev) => {
      if (longPressed) {
        // 長押しで既にメニューを開いたので、そのあとに来るclick（＝選択）は
        // 打ち消す——選択とメニュー表示が同時に起きるのを防ぐ。
        ev.preventDefault();
        longPressed = false;
        return;
      }
      selectRoom();
    });
  }

  /** ルーム名にホバー（PC）／長押し（タッチ）したときに開く、そのルームの
   *  操作メニュー。今は「名前を変更」の1件のみだが、今後増える操作もここに
   *  並べていく想定（ユーザー指示）。.shared-room-list（一覧）はoverflow-y:auto
   *  で内側だけスクロールするため、その中にposition:absoluteの子として置くと
   *  はみ出した分が切られてしまう——canvasView.tsの.text-editor-overlayと
   *  同じ理由でposition:fixed・body直下にして回避している。 */
  private openRoomActionsMenu(anchorBtn: HTMLButtonElement, li: HTMLLIElement, room: SharedCanvasSummary): void {
    this.closeRoomActionsMenu();

    const actions: { label: string; onSelect: () => void }[] = [
      { label: "名前を変更", onSelect: () => this.startRename(li, room) },
    ];

    const menu = document.createElement("div");
    menu.className = "shared-room-actions-menu";
    for (const action of actions) {
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "shared-room-action-btn";
      actionBtn.textContent = action.label;
      actionBtn.addEventListener("click", () => {
        this.closeRoomActionsMenu();
        action.onSelect();
      });
      menu.appendChild(actionBtn);
    }
    document.body.appendChild(menu);
    this.roomActionsMenuEl = menu;

    const anchorRect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 6;
    let top = anchorRect.bottom + margin;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = anchorRect.top - menuRect.height - margin;
    }
    const left = Math.max(
      margin,
      Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - margin)
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    const onOutside = (ev: PointerEvent) => {
      if (ev.target instanceof Node && (menu.contains(ev.target) || anchorBtn.contains(ev.target))) return;
      this.closeRoomActionsMenu();
    };
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") this.closeRoomActionsMenu();
    };
    // 開いた直後の同じクリック／タップで即座に閉じてしまわないよう、
    // 次のイベントループから listen する。
    const listenTimer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onOutside);
      document.addEventListener("keydown", onKeydown);
    }, 0);
    this.roomActionsMenuCleanup = () => {
      window.clearTimeout(listenTimer);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onKeydown);
    };
  }

  private closeRoomActionsMenu(): void {
    this.roomActionsMenuCleanup?.();
    this.roomActionsMenuCleanup = null;
    this.roomActionsMenuEl?.remove();
    this.roomActionsMenuEl = null;
  }

  /** ルームから退出する。他のメンバーが誰も残っていない場合、サーバー側で
   *  ルーム自体も即削除される（バックエンド仕様）——確認ダイアログはその
   *  可能性を含めて伝える。 */
  private async handleLeave(id: string, label: string, btn: HTMLButtonElement): Promise<void> {
    const confirmed = window.confirm(
      `「${label}」から退出します。他のメンバーが誰も残っていない場合、ルーム自体も削除されます。よろしいですか？`
    );
    if (!confirmed) return;
    btn.disabled = true;
    try {
      await leaveSharedCanvas(id);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "退出に失敗しました");
      btn.disabled = false;
      return;
    }
    this.rooms = this.rooms.filter((room) => room.id !== id);
    // 今表示中のルームから退出した場合、一覧上はどれも選択されていない
    // 状態に戻す（キャンバス自体は次にルームを選ぶまでそのまま残る）。
    if (this.selectedId === id) {
      this.selectedId = null;
      this.updateTriggerLabel();
    }
    this.renderRoomList();
  }

  /** ルーム項目の名前ボタンを、blurで確定・Escapeでキャンセルする入力欄に一時的に置き換える。
   *  確定時はPATCH /shared-canvases/:idでサーバーに保存し、他のメンバーにも
   *  見える名前になる（バックエンド仕様、2026-08-24）。 */
  private startRename(li: HTMLLIElement, room: SharedCanvasSummary): void {
    const labelBtn = li.querySelector<HTMLButtonElement>(".shared-room-btn");
    if (!labelBtn) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "shared-room-rename-input";
    // 未設定の名前の初期値はid（UUID全体）ではなく空にする——編集せずに
    // フォーカスを外しただけでUUID丸ごとが名前として保存される事故を防ぐ。
    // id自体はplaceholderとして薄く見せておく。
    input.value = room.name ?? "";
    input.placeholder = `${room.id.slice(0, 8)}…`;
    labelBtn.replaceWith(input);
    input.focus();
    input.select();

    // 日本語IMEの変換候補確定は、キー入力としてはEnter/Escapeだが、
    // 名前入力全体の確定・取り消しではない——canvasView.tsのテキスト編集
    // （openTextEditor）と同じcompositionstart/end追跡パターンを使う。
    let composing = false;
    let lastCompositionEndAt = 0;
    const COMPOSITION_GRACE_MS = 50;
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      lastCompositionEndAt = performance.now();
    });

    let cancelled = false;
    input.addEventListener("blur", () => {
      if (cancelled) {
        this.renderRoomList();
        return;
      }
      const trimmed = input.value.trim();
      // サーバーは空の名前を受け付けない（1〜100文字必須）ため、空欄のまま
      // フォーカスを外した場合は「変更しない」扱いにする（削除APIは無い）。
      if (!trimmed || trimmed === room.name) {
        this.renderRoomList();
        return;
      }
      input.disabled = true;
      void renameSharedCanvas(room.id, trimmed)
        .then(() => {
          room.name = trimmed;
        })
        .catch((e) => {
          this.setStatus(e instanceof Error ? e.message : "名前の保存に失敗しました");
        })
        .finally(() => {
          this.renderRoomList();
        });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.isComposing && !composing) {
        cancelled = true;
        input.blur();
        return;
      }
      const justFinishedComposing = performance.now() - lastCompositionEndAt < COMPOSITION_GRACE_MS;
      if (e.key === "Enter" && !e.isComposing && !composing && e.keyCode !== 229 && !justFinishedComposing) {
        e.preventDefault();
        input.blur();
      }
    });
  }
}
