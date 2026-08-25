import { getSharedCanvas, saveSharedCanvas } from "./sharedCanvas";
import type { SharedCanvasDetail } from "./sharedCanvas";
import type { Memo } from "./types";

/** ポーリング/WS経由の変更検知で見るべき部分だけを取り出す。session・ownerId等は
 *  この仕組みでは扱わない（sessionは別経路、ownerIdは実質不変のため）。 */
function syncKey(detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId">): string {
  return JSON.stringify({ memos: detail.memos, frameShapeId: detail.frameShapeId, framePatternId: detail.framePatternId });
}

const PUSH_DEBOUNCE_MS = 2000;
// サーバー(index.js)のWebSocket通知（realtimeSync.ts経由）でほぼ即座に
// 変更を検知できるようになったため、ポーリングは「通知を取りこぼした場合の
// 保険」という位置づけに下げてよく、間隔を伸ばしてサーバー負荷を減らす。
export const SHARED_POLL_INTERVAL_MS = 15000;

/**
 * 1つのルーム（共有キャンバス）に対する、書き込み(PUT)のデバウンス送信と、
 * 他メンバーの変更取り込みをまとめて担う。取り込みは主にWebSocket通知
 * （realtimeSync.tsが受け取り、SmuiView経由でpollNow()を呼ぶ）で即座に
 * 行い、定期ポーリング(GET)は通知の取りこぼしに備えた保険として残す
 * ——本格的な競合解決はせず、最後に保存した内容が勝つ単純な方式（cloudSync.tsの
 * 個人キャンバス向け同期と同じ考え方）。
 */
export class SharedRoomSync {
  private id: string;
  private onRemoteChange: (detail: SharedCanvasDetail) => void;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
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

  constructor(id: string, onRemoteChange: (detail: SharedCanvasDetail) => void) {
    this.id = id;
    this.onRemoteChange = onRemoteChange;
  }

  /** 初回ハイドレート直後など、今の内容をpush不要の「同期済み」として記録しておく。 */
  markSynced(detail: Pick<SharedCanvasDetail, "memos" | "frameShapeId" | "framePatternId">): void {
    this.lastSyncedJson = syncKey(detail);
    this.lastFrameShapeId = detail.frameShapeId;
    this.lastFramePatternId = detail.framePatternId;
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

  /** WebSocketで「変わった」通知を受け取った時に、次の定期ポーリングを
   *  待たずすぐ取得し直す。通知が来ない環境（再接続中など）でも定期
   *  ポーリング自体は動き続けるので、こちらは無くても壊れない「保険の上乗せ」。
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
