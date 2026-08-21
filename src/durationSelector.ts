import type { LifespanDays } from "./types";

type Choice = { label: string; lifespanDays: LifespanDays };

/** 1分・15分・30分を「日数」に換算した値。fade.tsのcomputeOpacityは
 *  lifespanDaysに小数日数を渡しても同じ比率(1/7, 3/7)でそのままスケールするため、
 *  分単位のテスト用の短い猶予期間もここでは普通に「日数の小数」として表現できる。 */
const MINUTES_PER_DAY = 24 * 60;
const oneMinute = 1 / MINUTES_PER_DAY;
const fifteenMinutes = 15 / MINUTES_PER_DAY;
const thirtyMinutes = 30 / MINUTES_PER_DAY;

/**
 * 消える機能の動作確認用に、期間指定ペンの猶予期間を実運用値（今日中/3日/1週間）
 * ではなく短い分単位にしてある（ユーザー指示によるテスト用設定）。
 * 「標準」（7日固定カーブ、lifespanDays=null）の選択肢はユーザー指示により削除した
 * ——新しく書くメモは必ずいずれかの期間を明示的に持つ。ただし fade.ts の
 * computeOpacity自体はnullを引き続き受け付ける（更新前に保存された既存データの
 * 後方互換のため。すでにlifespanDays=nullで保存されているメモは変わらず7日カーブで消える）。
 */
const CHOICES: Choice[] = [
  { label: "1分", lifespanDays: oneMinute },
  { label: "15分", lifespanDays: fifteenMinutes },
  { label: "30分", lifespanDays: thirtyMinutes },
];

/**
 * 「消えるまでの期間」だけを選ぶ、控えめな1行のセグメントコントロール。
 * 道具（Toolbar）とは独立した軸として扱う。
 */
export class DurationSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private index = 0; // 先頭の選択肢がデフォルト

  constructor(container: HTMLElement, onChange?: () => void) {
    this.container = container;
    this.onChange = onChange;
    this.el = document.createElement("div");
    this.el.className = "duration-row";
    this.container.appendChild(this.el);
    this.renderInto();
  }

  getLifespanDays(): LifespanDays {
    return CHOICES[this.index].lifespanDays;
  }

  private renderInto(): void {
    this.el.innerHTML = "";
    CHOICES.forEach((choice, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "duration-btn";
      btn.textContent = choice.label;
      btn.style.opacity = i === this.index ? "1" : "0.4";
      btn.addEventListener("click", () => {
        this.index = i;
        this.renderInto();
        this.onChange?.();
      });
      this.el.appendChild(btn);
    });
  }
}
