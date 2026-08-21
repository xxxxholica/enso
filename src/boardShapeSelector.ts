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
 */
export class BoardShapeSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: (id: BoardShapeId) => void;
  private shapeId: BoardShapeId;

  constructor(container: HTMLElement, onChange?: (id: BoardShapeId) => void) {
    this.container = container;
    this.onChange = onChange;
    this.shapeId = loadBoardShape();
    this.el = document.createElement("div");
    this.el.className = "toolbar-pill";
    this.container.appendChild(this.el);
    this.renderInto();
  }

  getShapeId(): BoardShapeId {
    return this.shapeId;
  }

  private setShapeId(id: BoardShapeId): void {
    if (this.shapeId === id) return;
    this.shapeId = id;
    saveBoardShape(id);
    this.renderInto();
    this.onChange?.(id);
  }

  private renderInto(): void {
    this.el.innerHTML = "";
    for (const id of SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", `盤面: ${BOARD_SHAPES[id].label}`);
      btn.setAttribute("aria-pressed", String(this.shapeId === id));
      btn.dataset.active = String(this.shapeId === id);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.setShapeId(id));
      this.el.appendChild(btn);
    }
  }
}
