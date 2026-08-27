/**
 * issue #128: 共有ルームのリアクション専用フェーズ(序列づけ/審議、議論の非マスター)
 * の間、道具バー(Toolbar.setHidden)の代わりに同じ場所へ出すバー。「押せない
 * だけの道具バー」に見えてリアクション機能があること自体が伝わりにくい
 * （ユーザー指摘）ため、今使える操作（タップでリアクション）とその対象emojiを
 * 前面に出す。実際のリアクション送信自体はメモをタップして開くReactionPicker
 * （smuiView.ts）が担い、このバー自体は選択操作を持たない案内・legend。
 */
export class ReactionBar {
  private el: HTMLElement;
  private labelEl: HTMLElement;
  private emojiRowEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    // toolbar fade-visible と同じクラスを流用し、道具バーと入れ替わっても
    // 見た目（背景・角丸・フェード挙動）が揃うようにする。
    this.el.className = "toolbar reaction-bar fade-visible";
    this.el.hidden = true;

    this.labelEl = document.createElement("p");
    this.labelEl.className = "reaction-bar-label";
    this.el.appendChild(this.labelEl);

    this.emojiRowEl = document.createElement("div");
    this.emojiRowEl.className = "reaction-bar-emoji-row";
    this.el.appendChild(this.emojiRowEl);

    container.appendChild(this.el);
  }

  /** 表示する/しないを切り替える。update()と違いフェードは伴わない
   *  （Toolbar.setHiddenと同じ即時切り替え、main.tsのタブ切り替えフェードとは別物）。 */
  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    this.el.classList.toggle("is-visible", visible);
  }

  /** フェーズが変わるたびに呼ぶ。案内文と、今このフェーズで使えるemojiの
   *  一覧（凡例、押せるボタンではない）を差し替える。 */
  update(label: string, allowedEmoji: readonly string[]): void {
    this.labelEl.textContent = label;
    this.emojiRowEl.innerHTML = "";
    for (const emoji of allowedEmoji) {
      const span = document.createElement("span");
      span.className = "reaction-bar-emoji";
      span.textContent = emoji;
      this.emojiRowEl.appendChild(span);
    }
  }
}
