import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { buildFramePatternPicker } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { ICONS } from "./icons";

/**
 * 個人キャンバス用の「見た目の設定」トリガー。共有キャンバスのAppearanceSelector
 * と違い、形の変更・ルームマスターによるロック・サーバー同期は無い(この端末だけの
 * ローカル設定、storage.tsのloadPersonalFramePattern/savePersonalFramePattern)ため、
 * 色の区画1つだけを持つ軽量な別実装にしている。トリガーの見た目・ラベル文言は
 * AppearanceSelectorと揃え(ユーザー指摘：文字が無くて何のボタンか伝わらない)、
 * 同じ.appearance-trigger（アイコン+文字のpill、狭幅では短縮表示）を使う。
 *
 * 選択肢は共有キャンバスと同じ4種(FRAME_PATTERN_ORDER)。個人キャンバスは
 * 常に片眼鏡(frameKind:"monocle"、canvasView.ts)のタブ+チェーンを表示するため
 * 「フレームなし」の選択肢は不要と判断し廃止した(ユーザー指示)。
 */
export class FrameColorSelector {
  private anchor: HTMLElement;
  private triggerBtn: HTMLButtonElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  constructor(container: HTMLElement, initialPatternId: FramePatternId, onPatternChange: (id: FramePatternId) => void) {
    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.triggerBtn = document.createElement("button");
    this.triggerBtn.type = "button";
    this.triggerBtn.className = "pill-btn appearance-trigger";
    this.triggerBtn.setAttribute("aria-label", "見た目の設定");
    this.triggerBtn.innerHTML = `${ICONS.appearance}<span class="label-full">見た目の設定</span><span class="label-short">見た目</span>`;
    this.triggerBtn.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.triggerBtn);

    this.popover = document.createElement("div");
    this.popover.className = "appearance-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    const patternPicker = buildFramePatternPicker(initialPatternId, (id) => onPatternChange(id));
    this.popover.appendChild(patternPicker.element);

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);
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
}
