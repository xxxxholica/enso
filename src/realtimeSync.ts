import type { AuthSession } from "./clerkAccount";

/**
 * 個人キャンバスのクラウド保存を、ページを開いたままでも他端末の変更が
 * 自動で反映されるようにするためのWebSocket接続。
 *
 * サーバー(api.onunu.me)は変更内容そのものを流すのではなく、
 * 「変わったよ」という軽い通知（{ type: "changed" }）だけを送ってくる。
 * 受け取ったら呼び出し側が渡した onChanged を呼び、実際の反映は
 * 既存のcloudSync.refreshFromCloud()（＝通常のGET /canvas）に任せる
 * ——最後に同期した内容で丸ごと上書きする、という既存の同期方式と揃えるため。
 */

const WS_BASE = "wss://api.onunu.me/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/**
 * ログイン中に1回呼ぶ。戻り値の関数を呼ぶと切断する（ログアウト時に呼ぶこと）。
 * 接続が切れた場合は指数バックオフで自動的に再接続を試みる
 * （スマホのスリープからの復帰やネットワーク切り替えでの切断を想定）。
 */
export function connectRealtimeSync(session: AuthSession, onChanged: () => void): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = RECONNECT_BASE_MS;
  let closed = false;

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
    });

    ws.addEventListener("message", (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if ((msg as { type?: unknown }).type === "changed") {
        console.log("[realtimeSync] changed notification received");
        onChanged();
      }
    });

    ws.addEventListener("close", (event) => {
      if (socket === ws) socket = null;
      console.warn("[realtimeSync] disconnected", event.code, event.reason);
      if (!closed) scheduleReconnect();
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

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
  };
}
