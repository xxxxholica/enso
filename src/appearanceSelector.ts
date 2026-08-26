import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { FRAME_SHAPE_ORDER, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { FRAME_PATTERN_ORDER, getFramePattern } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { ICONS } from "./icons";

const SHAPE_ICON: Record<FrameShapeId, string> = {
  round: ICONS.shapeRound,
  oval: ICONS.shapeOval,
  square: ICONS.shapeSquare,
};

const PATTERN_ICON: Record<FramePatternId, string> = {
  matte: ICONS.patternMatte,
  tortoiseshell: ICONS.patternTortoiseshell,
  clear: ICONS.patternClear,
  wood: ICONS.patternWood,
};

/**
 * 共有キャンバス（眼鏡形状）の「見た目の設定」。フレームの形（丸眼鏡/楕円/
 * 長方形）と色（マット/べっ甲/クリア/木目）を1つにまとめ、ルーム作成・選択
 * メニュー（SharedRoomMenu）と同じ.icon-anchor/.icon-popoverパターンの
 * トリガーボタン1つに収める（ユーザー指示）——以前は形・色それぞれに別々の
 * トリガーボタンを並べていたが、指示を受けて1つの「見た目の設定」ボタンの
 * 中で「フレームの形」「フレームの色」の2区画に分けて選ぶ形にした。
 *
 * ルームの一覧選択（決定して閉じる操作）と違い、こちらは形・色を交互に
 * 試しながら決めたい設定なので、選んでもポップアップは閉じない——トリガー
 * ボタンをもう一度押すまで開いたままにする。
 *
 * ルームメニュー（SharedRoomMenu）とは並べて置かれているため、両方同時に
 * 開いていると窮屈（ユーザー指摘）——exclusivePopover経由で、こちらを開くと
 * 向こうが開いていれば自動で閉じる（逆も同様）。
 */
export class AppearanceSelector {
  private anchor: HTMLElement;
  private triggerBtn: HTMLButtonElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  private shapeId: FrameShapeId;
  private patternId: FramePatternId;
  private onShapeChange: (id: FrameShapeId) => void;
  private onPatternChange: (id: FramePatternId) => void;
  private shapeButtons = new Map<FrameShapeId, HTMLButtonElement>();
  private patternButtons = new Map<FramePatternId, HTMLButtonElement>();

  constructor(
    container: HTMLElement,
    initialShapeId: FrameShapeId,
    initialPatternId: FramePatternId,
    onShapeChange: (id: FrameShapeId) => void,
    onPatternChange: (id: FramePatternId) => void
  ) {
    this.shapeId = initialShapeId;
    this.patternId = initialPatternId;
    this.onShapeChange = onShapeChange;
    this.onPatternChange = onPatternChange;

    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.triggerBtn = document.createElement("button");
    this.triggerBtn.type = "button";
    this.triggerBtn.className = "pill-btn appearance-trigger";
    this.triggerBtn.setAttribute("aria-label", "見た目の設定");
    // 画面幅が狭いと3ボタン（ルーム作成・見た目の設定・セッション開始）が
    // 並びきらない（ユーザー指摘）ため、.label-full/.label-shortをCSS側の
    // メディアクエリで出し分けて短縮表示にする（style.css参照）。
    this.triggerBtn.innerHTML = `${ICONS.appearance}<span class="label-full">見た目の設定</span><span class="label-short">見た目</span>`;
    this.triggerBtn.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.triggerBtn);

    this.popover = document.createElement("div");
    this.popover.className = "appearance-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    const shapeSection = document.createElement("div");
    shapeSection.className = "shared-menu-section";
    const shapeLabel = document.createElement("div");
    shapeLabel.className = "shared-section-label";
    shapeLabel.textContent = "フレームの形";
    shapeSection.appendChild(shapeLabel);
    const shapeRow = document.createElement("div");
    shapeRow.className = "toolbar-pill";
    for (const id of FRAME_SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFrameShape(id).label);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.selectShape(id));
      this.shapeButtons.set(id, btn);
      shapeRow.appendChild(btn);
    }
    shapeSection.appendChild(shapeRow);
    this.popover.appendChild(shapeSection);

    const patternSection = document.createElement("div");
    patternSection.className = "shared-menu-section";
    const patternLabel = document.createElement("div");
    patternLabel.className = "shared-section-label";
    patternLabel.textContent = "フレームの色";
    patternSection.appendChild(patternLabel);
    const patternRow = document.createElement("div");
    patternRow.className = "toolbar-pill";
    for (const id of FRAME_PATTERN_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFramePattern(id).label);
      btn.innerHTML = PATTERN_ICON[id];
      btn.addEventListener("click", () => this.selectPattern(id));
      this.patternButtons.set(id, btn);
      patternRow.appendChild(btn);
    }
    patternSection.appendChild(patternRow);
    this.popover.appendChild(patternSection);

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);

    this.syncShape();
    this.syncPattern();
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    notifyOpen(this.closeRef, this.anchor);
    this.open = true;
    this.triggerBtn.dataset.active = "true";
    this.popoverFade(true);
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.triggerBtn.dataset.active = "false";
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  private selectShape(id: FrameShapeId): void {
    if (id === this.shapeId) return;
    this.shapeId = id;
    this.syncShape();
    this.onShapeChange(id);
  }

  private selectPattern(id: FramePatternId): void {
    if (id === this.patternId) return;
    this.patternId = id;
    this.syncPattern();
    this.onPatternChange(id);
  }

  private syncShape(): void {
    for (const [id, btn] of this.shapeButtons) {
      const active = id === this.shapeId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  private syncPattern(): void {
    for (const [id, btn] of this.patternButtons) {
      const active = id === this.patternId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  /** 共有ルームに接続中、ルームマスター以外の間だけ呼ぶ（main.tsのframe()
   *  ループから毎フレーム呼んでよい——値が変わらない限りDOMは触らない）。
   *  トリガー自体は開けたままにし、今の設定を見られるようにする——押しても
   *  反映されないことはボタン自体のdisabled表示で伝える。 */
  setLocked(locked: boolean): void {
    for (const [, btn] of this.shapeButtons) btn.disabled = locked;
    for (const [, btn] of this.patternButtons) btn.disabled = locked;
  }

  /** ルーム側の見た目（サーバーに保存された値）を反映する。ユーザー操作を
   *  経ないため、onShapeChange/onPatternChangeは呼ばない——呼ぶと自分が
   *  受け取った値をそのまま送り返すだけの無意味なPATCHが発生してしまう。 */
  setValues(shapeId: FrameShapeId, patternId: FramePatternId): void {
    if (shapeId !== this.shapeId) {
      this.shapeId = shapeId;
      this.syncShape();
    }
    if (patternId !== this.patternId) {
      this.patternId = patternId;
      this.syncPattern();
    }
  }
}
