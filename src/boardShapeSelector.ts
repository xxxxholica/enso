import { BOARD_SHAPES } from "./boardShape";
import type { BoardShapeId } from "./boardShape";
import { ICONS } from "./icons";
import { loadBoardShape, saveBoardShape } from "./storage";

const SHAPE_ORDER: BoardShapeId[] = ["circle", "glasses"];
const SHAPE_ICON: Record<BoardShapeId, string> = {
  circle: ICONS.shapeCircle,
  glasses: ICONS.shapeGlasses,
};

/**
 * 盤面の形（円／眼鏡）を切り替えるピル型セレクタ。道具バーと同じ見た目を使う。
 * 既定は円（ユーザー指示により、円だけだと寂しいので眼鏡型も選べるようにしたが、
 * これまでの見た目・保存済みメモとの互換性を保つため既定は円のまま）。
 * 形を変えると座標系（正規化の基準）が変わり、書いた内容を保ったまま移すことはできないため、
 * 盤面に何か書かれているときだけ「全部消す」と同じ趣旨のインライン確認を挟む。
 * 何も書かれていなければ消えるものが無いので、確認なしでそのまま切り替える（ユーザー指示）。
 */
export class BoardShapeSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private hasContent: () => boolean;
  private onChange?: (id: BoardShapeId) => void;
  private shapeId: BoardShapeId;
  /** 確認待ちの切り替え先。nullなら通常表示（ピル）、そうでなければ確認メッセージを表示中。 */
  private pendingShapeId: BoardShapeId | null = null;

  /** hasContentは、今の盤面に消えてしまうものがあるか（アクティブなメモが1つ以上あるか）を返す。
   *  何も書かれていなければリセットされるものが無いので、確認を挟まずそのまま切り替える
   *  （ユーザー指示）。 */
  constructor(container: HTMLElement, hasContent: () => boolean, onChange?: (id: BoardShapeId) => void) {
    this.container = container;
    this.hasContent = hasContent;
    this.onChange = onChange;
    this.shapeId = loadBoardShape();
    this.el = document.createElement("div");
    this.container.appendChild(this.el);
    this.renderInto();
  }

  getShapeId(): BoardShapeId {
    return this.shapeId;
  }

  private requestShapeId(id: BoardShapeId): void {
    if (this.shapeId === id) return;
    if (!this.hasContent()) {
      this.applyShapeId(id);
      return;
    }
    this.pendingShapeId = id;
    this.renderInto();
  }

  private applyShapeId(id: BoardShapeId): void {
    this.shapeId = id;
    saveBoardShape(id);
    this.renderInto();
    this.onChange?.(id);
  }

  private confirmPending(): void {
    if (this.pendingShapeId === null) return;
    const id = this.pendingShapeId;
    this.pendingShapeId = null;
    this.applyShapeId(id);
  }

  private cancelPending(): void {
    this.pendingShapeId = null;
    this.renderInto();
  }

  private renderInto(): void {
    this.el.innerHTML = "";

    if (this.pendingShapeId !== null) {
      this.el.className = "shape-confirm";
      const message = document.createElement("span");
      message.textContent = "盤面を切り替えると、書いた内容もリセットされます。よろしいですか？";
      this.el.appendChild(message);

      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.className = "text-link";
      yesBtn.textContent = "はい";
      yesBtn.addEventListener("click", () => this.confirmPending());
      this.el.appendChild(yesBtn);

      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.className = "text-link";
      noBtn.textContent = "いいえ";
      noBtn.addEventListener("click", () => this.cancelPending());
      this.el.appendChild(noBtn);
      return;
    }

    this.el.className = "toolbar-pill";
    for (const id of SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", `盤面: ${BOARD_SHAPES[id].label}`);
      btn.setAttribute("aria-pressed", String(this.shapeId === id));
      btn.dataset.active = String(this.shapeId === id);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.requestShapeId(id));
      this.el.appendChild(btn);
    }
  }
}
