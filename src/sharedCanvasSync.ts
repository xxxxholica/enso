import { getSharedCanvas, saveSharedCanvas } from "./sharedCanvas";
import type { SessionState, SharedCanvasDetail } from "./sharedCanvas";
import type { Memo } from "./types";

/** GET経由の変更検知で見るべき部分だけを取り出す。ownerId等は対象外
 *  （実質不変のため）。sessionは別途onSessionSeenで毎回渡すためここでは扱わない。 */
function syncKey(detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId">): string {
  return JSON.stringify({ memos: detail.memos, frameShapeId: detail.frameShapeId, framePatternId: detail.framePatternId });
}

const PUSH_DEBOUNCE_MS = 2000;

/**
 * 1つのルーム（共有キャンバス）に対する、書き込み(PUT)のデバウンス送信と、
 * 他メンバーの変更取り込みをまとめて担う。取り込みはWebSocket通知
 * （realtimeSync.tsが受け取り、SmuiView経由でpollNow()を呼ぶ）と、
 * 再接続直後のresync（同じくpollNow()経由）でのみ行う——定期ポーリングは
 * 持たない（WS接続が生きている間はメッセージを取りこぼさないため、保険は
 * 「再接続の瞬間に取得し直す」だけで足りる、issue #79）。本格的な競合解決は
 * せず、最後に保存した内容が勝つ単純な方式（cloudSync.tsの個人キャンバス
 * 向け同期と同じ考え方）。
 */
export class SharedRoomSync {
  private id: string;
  private onRemoteChange: (detail: SharedCanvasDetail) => void;
  private onSessionSeen: (session: SessionState | null) => void;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushInFlight = false;
  /** poll()の多重実行防止。WebSocket通知は短時間に連続で届き得るため、
   *  前回のGETがまだ終わっていない間に来た通知は無視する（schedulePush側の
   *  pushInFlightと同じ考え方）。 */
  private pollInFlight = false;
  /** 自分が最後にサーバーへ送った(または取得した)内容。自分のpushをポーリングが
   *  そのまま拾い直して二重に反映してしまわないための判定に使う。 */
  private lastSyncedJson: string | null = null;
  /** schedulePush()はmemosしか知らないため、直近の見た目(フレームの形・柄)を
   *  ここに覚えておき、push成功時にlastSyncedJsonを組み直すのに使う
   *  ——見た目自体はupdateSharedAppearance経由で別に送られるため、ここでは
   *  「今その値をサーバーが持っているはず」という直近の観測値でしかない。 */
  private lastFrameShapeId: SharedCanvasDetail["frameShapeId"] = null;
  private lastFramePatternId: SharedCanvasDetail["framePatternId"] = null;

  constructor(
    id: string,
    onRemoteChange: (detail: SharedCanvasDetail) => void,
    onSessionSeen: (session: SessionState | null) => void
  ) {
    this.id = id;
    this.onRemoteChange = onRemoteChange;
    this.onSessionSeen = onSessionSeen;
  }

  /** 初回ハイドレート直後など、今の内容をpush不要の「同期済み」として記録しておく。 */
  markSynced(detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId">): void {
    this.lastSyncedJson = syncKey(detail);
    this.lastFrameShapeId = detail.frameShapeId;
    this.lastFramePatternId = detail.framePatternId;
  }

  /** ルームを離れる／切り替える時の完全停止。デバウンス中の未送信pushも
   *  破棄する——ここで待たずに確実に止める。 */
  stop(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
  }

  private hasPendingLocalChanges(): boolean {
    return this.pushTimer !== undefined || this.pushInFlight;
  }

  /** WebSocketの「変わった」通知、または再接続直後のresyncで呼ぶ。
   *  force=trueは、ローカルの未送信push(hasPendingLocalChanges)があっても
   *  待たせず取得する——投票フェーズ終了直後、確定したfadeExempt/frozenDensity
   *  をすぐ反映させたい呼び出し元(smuiView.ts)用。heat/fadeExempt/frozenDensity
   *  はサーバー側のPUTハンドラがクライアントの送信内容によらず常に上書きする
   *  値なので、pushが同時に飛んでいてもこの3フィールドを壊す心配はない。 */
  pollNow(force = false): void {
    void this.poll(force);
  }

  schedulePush(memos: readonly Memo[]): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.pushInFlight = true;
      void saveSharedCanvas(this.id, memos)
        .then(() => {
          this.lastSyncedJson = syncKey({
            memos: memos as Memo[],
            frameShapeId: this.lastFrameShapeId,
            framePatternId: this.lastFramePatternId,
          });
        })
        .catch((e) => {
          console.error("[sharedCanvasSync] push failed", e);
        })
        .finally(() => {
          this.pushInFlight = false;
        });
    }, PUSH_DEBOUNCE_MS);
  }

  private async poll(force = false): Promise<void> {
    if ((this.hasPendingLocalChanges() && !force) || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const detail = await getSharedCanvas(this.id);
      // sessionはmemos/frameの変化と無関係に、取得するたびに毎回通知する
      // （WS通知の取りこぼし時にセッションのフェーズ状態を復旧できるのは
      // この経路だけのため、syncKeyの差分判定の対象外にしてある）。
      this.onSessionSeen(detail.session);
      const json = syncKey(detail);
      if (json === this.lastSyncedJson) return;
      this.lastSyncedJson = json;
      this.lastFrameShapeId = detail.frameShapeId;
      this.lastFramePatternId = detail.framePatternId;
      this.onRemoteChange(detail);
    } catch (e) {
      console.error("[sharedCanvasSync] poll failed", e);
    } finally {
      this.pollInFlight = false;
    }
  }
}
