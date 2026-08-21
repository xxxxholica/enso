import type { LifespanDays } from "./types";
import { DURATION_STEPS } from "./durationSteps";
import { MS_PER_DAY } from "./fade";

/**
 * 下部バー・右ブロック（時間選択ブロック）: 「消えるまでの期間」だけを選ぶ
 * シークバー。道具（Toolbar）とは独立した軸として扱う。
 *
 * 以前は3択（1分/15分/30分——動作確認用の短い値）のセグメントコントロールだったが、
 * 振り返りのシークバーと目盛りの感覚を揃えるため、DURATION_STEPS（15分〜7日の
 * 9段階）から選ぶインデックス式のスライダーに変更した（ユーザー指示）。
 * <input type="range">はstep幅が一定のものしか扱えないため、値そのものではなく
 * DURATION_STEPSの「インデックス」をスライダーの値として持ち、実際の日数への
 * 変換はgetLifespanDays()の中だけで行う。
 * 現在値のラベルはスライダーの上に表示する（振り返りのシークバーと同じ配置。
 * ユーザー指示）。DOM上はラベル→スライダーの順に積むだけで、縦積みのレイアウトは
 * style.cssの.duration-seekbar側（flex-direction: column）で行っている。
 */
export class DurationSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private labelEl!: HTMLElement;
  private slider!: HTMLInputElement;
  private index = 0; // 先頭（15分）がデフォルト

  constructor(container: HTMLElement, onChange?: () => void) {
    this.container = container;
    this.onChange = onChange;
    this.el = document.createElement("div");
    this.el.className = "duration-seekbar control-block";
    this.container.appendChild(this.el);
    this.build();
  }

  /** fade.tsのcomputeOpacityはlifespanDaysに小数日数を渡しても同じ比率
   *  (1/7, 3/7)でそのままスケールするため、分・時間単位の短い猶予期間も
   *  ここでは普通に「日数の小数」に換算するだけでよい。 */
  getLifespanDays(): LifespanDays {
    return DURATION_STEPS[this.index].ms / MS_PER_DAY;
  }

  private build(): void {
    this.labelEl = document.createElement("span");
    this.labelEl.className = "duration-seekbar-label";
    this.el.appendChild(this.labelEl);

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "duration-seekbar-slider";
    this.slider.min = "0";
    this.slider.max = String(DURATION_STEPS.length - 1);
    this.slider.step = "1";
    this.slider.value = String(this.index);
    this.slider.setAttribute("aria-label", "消えるまでの期間");
    this.slider.addEventListener("input", () => {
      this.index = Number(this.slider.value);
      this.syncLabel();
      this.onChange?.();
    });
    this.el.appendChild(this.slider);

    this.syncLabel();
  }

  private syncLabel(): void {
    this.labelEl.textContent = DURATION_STEPS[this.index].label;
  }
}
