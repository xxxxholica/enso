import { formatDurationJa } from "./fade";

/**
 * 「残り時間」を表示するピル（旧reviveInfoBox.tsのcanvas描画に代わるDOM表示、
 * ユーザー指摘：輪郭線が目立ちすぎる）。ツールバー直上の行に、共有ルームの
 * 「＋ルームを作成」等と同じ.pill-btnの見た目で置く（ユーザー指示）。
 * クリックできる操作ではないため、それらと違ってcursor/hover変化は持たない
 * （.revive-info-pill、style.css参照）。
 */
export class ReviveInfoPill {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "pill-btn revive-info-pill";
    this.el.hidden = true;
    container.appendChild(this.el);
  }

  /** remainingMsがnullなら隠す。呼び出し側（main.ts/smuiView.ts）がrender()の
   *  たびに、今表示中のタブ・対象メモの有無に応じて呼ぶ。 */
  update(remainingMs: number | null): void {
    if (remainingMs === null) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.el.textContent = `残り時間 ${formatDurationJa(remainingMs)}`;
  }
}
