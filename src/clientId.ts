/**
 * このタブ(実行コンテキスト)を識別するランダムなID。共有キャンバスの同期
 * (sharedCanvas.ts・realtimeSync.ts)で、「自分が送った変更が自分のWebSocket
 * 通知として跳ね返ってきたもの」を無視するために使う——サーバー側は中身を
 * 見ずそのまま素通しするだけ(ichimaien-api/index.js参照)。ページを開くたびに
 * 新しく生成し、永続化はしない(issue #99)。
 */
export const CLIENT_ID: string = crypto.randomUUID();
