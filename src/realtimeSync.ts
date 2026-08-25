import type { AuthSession } from "./clerkAccount";
import type { SessionState } from "./sharedCanvas";

/**
 * 個人キャンバス・共有キャンバスの両方で使う、単一のWebSocket接続。
 *
 * サーバー(api.onunu.me)は変更内容そのものを流すのではなく、
 * 「変わったよ」という軽い通知だけを送ってくる。個人キャンバスの変更は
 * canvasIdを持たない{ type: "changed" }、共有キャンバス（ルーム）の変更は
 * { type: "changed", canvasId }として届く——サーバー側のindex.jsで
 * broadcastPersonalChange/broadcastSharedChangeとして実装済み。
 * 受け取ったら呼び出し側が渡したonChanged/onSharedChangedを呼び、実際の
 * 反映は既存のcloudSync.refreshFromCloud()やSharedRoomSync.pollNow()
 * （＝通常のGETでの取得し直し）に任せる——最後に同期した内容で丸ごと
 * 上書きする、という既存の同期方式と揃えるため。
 *
 * 共有ルームの購読は、サーバー側に明示的な購読解除(unsubscribe)が無く、
 * 一度subscribeしたcanvasIdはソケットが切れるまで届き続ける仕様
 * （index.jsのws.on('close')参照）。呼び出し側（SmuiView）は届いた
 * canvasIdが「今表示中のルームか」を見て判断すればよいため、ここでは
 * 「最後にsubscribeしたいルームID」を覚えておき、再接続のたびに
 * 送り直すだけにとどめる（サーバー側の仕様に合わせた最小限の実装）。
 *
 * サーキットブレーカー: 何らかの理由（プロキシのタイムアウト等）で接続が
 * 短時間に何度も切れる「フラッピング」が起きると、通常の指数バックオフ
 * （最大15秒）だけでは再接続の試行が多くなりすぎ、トークン取得や
 * WebSocketハンドシェイクの負荷が積み重なってタブが重くなりかねない
 * （2026-08-24、実際にこれが疑われるブラウザフリーズが発生）。直近の
 * 切断回数を数えておき、短時間に切れすぎたら数分間、再接続そのものを
 * 止める。原因（サーバー・ネットワークいずれであれ）を問わず、再接続の
 * 暴走そのものを防ぐための最終防衛ライン。
 */

const WS_BASE = "wss://api.onunu.me/ws";
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15000;
/** この時間内に一定回数以上切断されたら「フラッピング」とみなす。 */
export const FLAP_WINDOW_MS = 30000;
export const FLAP_THRESHOLD = 5;
/** フラッピング検知後、再接続を試みるまでのクールダウン時間。 */
export const FLAP_COOLDOWN_MS = 3 * 60 * 1000;

export interface RealtimeSyncHandle {
  /** 切断する（ログアウト時に呼ぶこと）。 */
  disconnect: () => void;
  /** 指定した共有キャンバス（ルーム）の変更通知を受け取れるようにする。
   *  ソケットが未接続でも、次に接続した時点で自動的に送り直す。 */
  subscribeToRoom: (canvasId: string) => void;
}

/**
 * ログイン中に1回呼ぶ。接続が切れた場合は指数バックオフで自動的に再接続を
 * 試みる（スマホのスリープからの復帰やネットワーク切り替えでの切断を想定）。
 */
export function connectRealtimeSync(
  session: AuthSession,
  onChanged: () => void,
  onSharedChanged: (canvasId: string) => void,
  // 共同アイデア出しセッションの状態変化(開始/進行/延長/終了)。メモ内容を
  // 伴わないため、onSharedChangedのような「フルGETし直し」を挟まず、
  // このDTOをそのまま反映すればよい。
  onSessionChanged: (canvasId: string, session: SessionState | null) => void,
  // 投票フェーズ中、熱量が変わるたびに届く軽量な通知。フルGETを挟まず、
  // 手元のメモにその場で反映する（相対密度はcanvasView.tsが毎フレーム全メモ
  // から計算し直すため、サーバーが同梱するmaxHeatはここでは使わない）。
  onHeatChanged: (canvasId: string, memoId: string, heat: number) => void
): RealtimeSyncHandle {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = RECONNECT_BASE_MS;
  let closed = false;
  let pendingRoomId: string | null = null;
  let disconnectTimestamps: number[] = [];

  /** 切断のたびに呼ぶ。直近FLAP_WINDOW_MS以内の切断回数がFLAP_THRESHOLD以上
   *  ならフラッピングとみなしtrueを返す。 */
  function recordDisconnectAndCheckFlapping(): boolean {
    const now = Date.now();
    disconnectTimestamps.push(now);
    disconnectTimestamps = disconnectTimestamps.filter((t) => now - t <= FLAP_WINDOW_MS);
    return disconnectTimestamps.length >= FLAP_THRESHOLD;
  }

  function sendSubscribe(ws: WebSocket): void {
    if (!pendingRoomId) return;
    ws.send(JSON.stringify({ type: "subscribe", canvasId: pendingRoomId }));
  }

  async function open(): Promise<void> {
    if (closed) return;

    const token = await session.getToken();
    if (!token) {
      scheduleReconnect();
      return;
    }

    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectDelay = RECONNECT_BASE_MS;
      console.log("[realtimeSync] connected");
      sendSubscribe(ws);
    });

    ws.addEventListener("message", (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const parsed = msg as {
        type?: unknown;
        canvasId?: unknown;
        session?: unknown;
        memoId?: unknown;
        heat?: unknown;
      };
      if (parsed.type === "session-changed" && typeof parsed.canvasId === "string") {
        onSessionChanged(parsed.canvasId, (parsed.session ?? null) as SessionState | null);
        return;
      }
      if (
        parsed.type === "heat-changed" &&
        typeof parsed.canvasId === "string" &&
        typeof parsed.memoId === "string" &&
        typeof parsed.heat === "number"
      ) {
        onHeatChanged(parsed.canvasId, parsed.memoId, parsed.heat);
        return;
      }
      if (parsed.type !== "changed") return;
      if (typeof parsed.canvasId === "string") {
        console.log("[realtimeSync] shared canvas changed notification received", parsed.canvasId);
        onSharedChanged(parsed.canvasId);
      } else {
        console.log("[realtimeSync] changed notification received");
        onChanged();
      }
    });

    ws.addEventListener("close", (event) => {
      if (socket === ws) socket = null;
      console.warn("[realtimeSync] disconnected", event.code, event.reason);
      if (closed) return;
      if (recordDisconnectAndCheckFlapping()) {
        console.warn(
          `[realtimeSync] too many reconnects in ${FLAP_WINDOW_MS}ms — backing off for ${FLAP_COOLDOWN_MS}ms`
        );
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectDelay = RECONNECT_BASE_MS; // クールダウン明けは通常の速さから再開してよい
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          disconnectTimestamps = []; // クールダウン明けは仕切り直す
          void open();
        }, FLAP_COOLDOWN_MS);
      } else {
        scheduleReconnect();
      }
    });

    ws.addEventListener("error", (event) => {
      console.error("[realtimeSync] error", event);
      ws.close();
    });
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      void open();
    }, reconnectDelay);
  }

  void open();

  return {
    disconnect: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    },
    subscribeToRoom: (canvasId: string) => {
      pendingRoomId = canvasId;
      if (socket && socket.readyState === WebSocket.OPEN) sendSubscribe(socket);
    },
  };
}
