import type { PenSelection } from "./types";

type DurationChoice = 1 | 3 | 7;

const DURATION_LABEL: Record<DurationChoice, string> = {
  1: "今日中",
  3: "3日",
  7: "1週間",
};

/**
 * 標準ペン／期間指定ペンの切り替えUI。
 * 完了ボタンや確認ダイアログは持たない（選ぶだけで即座に反映）。
 */
export class PenSelector {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private mode: "standard" | "period" = "standard";
  private duration: DurationChoice = 1;

  constructor(container: HTMLElement, onChange?: () => void) {
    this.container = container;
    this.onChange = onChange;
    this.el = document.createElement("div");
    this.el.className = "pen-selector";
    this.container.appendChild(this.el);
    this.renderInto();
  }

  getSelection(): PenSelection {
    return this.mode === "standard"
      ? { kind: "standard" }
      : { kind: "period", lifespanDays: this.duration };
  }

  private renderInto(): void {
    this.el.innerHTML = "";

    const modeRow = document.createElement("div");
    modeRow.className = "pen-mode-row";

    const standardBtn = this.makeToggle("標準ペン", this.mode === "standard", () => {
      this.mode = "standard";
      this.renderInto();
      this.onChange?.();
    });
    const periodBtn = this.makeToggle("期間指定ペン", this.mode === "period", () => {
      this.mode = "period";
      this.renderInto();
      this.onChange?.();
    });
    modeRow.appendChild(standardBtn);
    modeRow.appendChild(periodBtn);
    this.el.appendChild(modeRow);

    if (this.mode === "period") {
      const durationRow = document.createElement("div");
      durationRow.className = "pen-duration-row";
      (Object.keys(DURATION_LABEL) as unknown as DurationChoice[])
        .map(Number)
        .forEach((d) => {
          const choice = d as DurationChoice;
          const btn = this.makeToggle(
            DURATION_LABEL[choice],
            this.duration === choice,
            () => {
              this.duration = choice;
              this.renderInto();
              this.onChange?.();
            },
            true
          );
          durationRow.appendChild(btn);
        });
      this.el.appendChild(durationRow);
    }
  }

  private makeToggle(
    label: string,
    active: boolean,
    onClick: () => void,
    small = false
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = small ? "pen-toggle pen-toggle-small" : "pen-toggle";
    btn.style.opacity = active ? "1" : "0.4";
    btn.addEventListener("click", onClick);
    return btn;
  }
}
