import { FRAME_SHAPE_ORDER, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { ICONS } from "./icons";

const SHAPE_ICON: Record<FrameShapeId, string> = {
  round: ICONS.shapeRound,
  oval: ICONS.shapeOval,
  square: ICONS.shapeSquare,
};

/**
 * SMUIのフレーム形状（丸眼鏡/楕円/長方形）の着せ替えセレクタ。ヘッダー右端、
 * アカウント表示の左隣に置く（main.ts、ユーザー指示——以前は下の操作パネルの
 * 4つ目のブロックだった）。既存の道具バーの.toolbar-btnと同じアイコンボタンを
 * 使うが、ヘッダーの他のボタン（アカウント・共有ルームメニュー）に合わせて
 * 枠線・背景付きの.control-blockは持たせない。過去の眼鏡盤面のBoardShapeSelector
 * にあった「切替前の確認ダイアログ」は、形状ごとに座標系が変わり破壊的だった
 * 旧設計特有の対策だったため、ここでは持たせない——形状は見た目のスキンに
 * 過ぎず、切替で既存メモが失われることはない。
 */
export class FrameShapeSelector {
  private el: HTMLElement;
  private shapeId: FrameShapeId;
  private onChange: (id: FrameShapeId) => void;
  private buttons = new Map<FrameShapeId, HTMLButtonElement>();

  constructor(container: HTMLElement, initial: FrameShapeId, onChange: (id: FrameShapeId) => void) {
    this.shapeId = initial;
    this.onChange = onChange;

    this.el = document.createElement("div");
    this.el.className = "toolbar-pill smui-shape-selector";
    for (const id of FRAME_SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFrameShape(id).label);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.select(id));
      this.buttons.set(id, btn);
      this.el.appendChild(btn);
    }
    container.appendChild(this.el);
    this.sync();
  }

  private select(id: FrameShapeId): void {
    if (id === this.shapeId) return;
    this.shapeId = id;
    this.sync();
    this.onChange(id);
  }

  private sync(): void {
    for (const [id, btn] of this.buttons) {
      const active = id === this.shapeId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }
}
