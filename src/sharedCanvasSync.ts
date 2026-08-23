import { getSharedCanvas, saveSharedCanvas } from "./sharedCanvas";
import type { Memo } from "./types";

const PUSH_DEBOUNCE_MS = 2000;
export const SHARED_POLL_INTERVAL_MS = 4000;

/**
 * 1つのルーム（共有キャンバス）に対する、書き込み(PUT)のデバウンス送信と
 * 定期ポーリング(GET)による他メンバーの変更取り込みをまとめて担う。
 * WebSocketが無いため「だいたいリアルタイムに見える」ことをポーリングで狙う
 * ——本格的な競合解決はせず、最後に保存した内容が勝つ単純な方式（cloudSync.tsの
 * 個人キャンバス向け同期と同じ考え方）。
 */
export class SharedRoomSync {
  private id: string;
  private onRemoteChange: (memos: Memo[]) => void;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pushInFlight = false;
  /** 自分が最後にサーバーへ送った(または取得した)内容。自分のpushをポーリングが
   *  そのまま拾い直して二重に反映してしまわないための判定に使う。 */
  private lastSyncedJson: string | null = null;

  constructor(id: string, onRemoteChange: (memos: Memo[]) => void) {
    this.id = id;
    this.onRemoteChange = onRemoteChange;
  }

  /** 初回ハイドレート直後など、今の内容をpush不要の「同期済み」として記録しておく。 */
  markSynced(memos: readonly Memo[]): void {
    this.lastSyncedJson = JSON.stringify(memos);
  }

  /** ルームに接続した直後の初回開始。 */
  start(): void {
    this.resumePolling();
  }

  /** ルームを離れる／切り替える時の完全停止。デバウンス中の未送信pushも
   *  破棄する——ここで待たずに確実に止める（SMUIの「共有」タブを離れる程度の
   *  操作でデータを失いたくない場合は、代わりにpausePolling/resumePollingを使う）。 */
  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pollTimer = undefined;
    this.pushTimer = undefined;
  }

  /** 「共有」タブを離れている間だけポーリングを止める（画面に映らない間、
   *  4秒おきのGETを続けても無駄なため）。デバウンス中のpushはそのまま
   *  進行させる——タブを離れただけで未保存の編集を失いたくないため。 */
  pausePolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  /** 「共有」タブに戻った時にポーリングを再開する。既に動いていれば何もしない
   *  （二重にsetIntervalしてしまい古い方のハンドルを見失うのを防ぐ）。 */
  resumePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.poll(), SHARED_POLL_INTERVAL_MS);
  }

  private hasPendingLocalChanges(): boolean {
    return this.pushTimer !== undefined || this.pushInFlight;
  }

  schedulePush(memos: readonly Memo[]): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.pushInFlight = true;
      const json = JSON.stringify(memos);
      void saveSharedCanvas(this.id, memos)
        .then(() => {
          this.lastSyncedJson = json;
        })
        .catch((e) => {
          console.error("[sharedCanvasSync] push failed", e);
        })
        .finally(() => {
          this.pushInFlight = false;
        });
    }, PUSH_DEBOUNCE_MS);
  }

  private async poll(): Promise<void> {
    if (this.hasPendingLocalChanges()) return;
    try {
      const detail = await getSharedCanvas(this.id);
      const json = JSON.stringify(detail.memos);
      if (json === this.lastSyncedJson) return;
      this.lastSyncedJson = json;
      this.onRemoteChange(detail.memos);
    } catch (e) {
      console.error("[sharedCanvasSync] poll failed", e);
    }
  }
}
