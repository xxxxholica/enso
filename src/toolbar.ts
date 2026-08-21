import { ICONS } from "./icons";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, type FontSizeStep } from "./textLayout";
import { TEMPLATES } from "./templates";
import type { TemplateId } from "./templates";
import type { DrawTool } from "./types";

export type ToolbarTool = DrawTool | "eraser" | "text" | "move";

const DEFAULT_INK = "oklch(22% 0.012 55)";
/** ネイティブのカラーピッカーを開く初期値。実際の描画色は色を変更するまでこの近似値ではなくDEFAULT_INKのまま。 */
const COLOR_INPUT_SEED = "#2f2a26";

const TOOL_ORDER: ToolbarTool[] = ["pencil", "pen", "marker", "text", "move", "eraser"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pencil: "鉛筆",
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "移動",
  eraser: "消しゴム",
};

const FONT_SIZE_ORDER: FontSizeStep[] = ["small", "medium", "large"];
const FONT_SIZE_LABEL: Record<FontSizeStep, string> = { small: "小", medium: "中", large: "大" };

/**
 * Appleメモ風の道具バー: 鉛筆／ペン／マーカー／テキスト／移動／消しゴムの切り替えと、
 * フルカラーのインク色選択（ネイティブのカラーピッカーを使う）。
 * テキストを選んでいる間だけ、文字サイズ（小/中/大）のステッパーを表示する。
 * 「消えるまでの期間」はここでは扱わない（DurationSelectorが別軸で担当）。
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private onInsertTemplate?: (id: TemplateId) => void;
  private tool: ToolbarTool = "pen";
  private color: string = DEFAULT_INK;
  private fontSizeStep: FontSizeStep = DEFAULT_FONT_SIZE_STEP;
  private colorInput: HTMLInputElement;
  /** テンプレートボタンを押した直後、どちらのテンプレートを置くか選ばせている間だけtrue。 */
  private templatePickerOpen = false;

  constructor(container: HTMLElement, onChange?: () => void, onInsertTemplate?: (id: TemplateId) => void) {
    this.container = container;
    this.onChange = onChange;
    this.onInsertTemplate = onInsertTemplate;

    this.el = document.createElement("div");
    this.el.className = "toolbar";
    this.container.appendChild(this.el);

    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.value = COLOR_INPUT_SEED;
    this.colorInput.className = "toolbar-color-input";
    this.colorInput.setAttribute("aria-label", "インクの色を選ぶ");
    this.colorInput.addEventListener("input", () => {
      this.color = this.colorInput.value;
      this.renderInto();
      this.onChange?.();
    });

    this.renderInto();
  }

  getTool(): ToolbarTool {
    return this.tool;
  }

  getColor(): string {
    return this.color;
  }

  /** 基準円(半径340px)におけるフォントサイズ(px)。実際の描画時はtextLayout.fontPxForRenderでスケール・下限適用する。 */
  getFontSize(): number {
    return FONT_SIZE_STEPS[this.fontSizeStep];
  }

  private setTool(tool: ToolbarTool): void {
    this.tool = tool;
    this.renderInto();
    this.onChange?.();
  }

  private setFontSizeStep(step: FontSizeStep): void {
    this.fontSizeStep = step;
    this.renderInto();
    this.onChange?.();
  }

  /** テンプレートボタンを押したら、どちらのテンプレートを置くか選ぶ小さな一覧を出す
   *  （ユーザー指示：クリックしたときにどちらかを選べるようにしたい）。 */
  private toggleTemplatePicker(): void {
    this.templatePickerOpen = !this.templatePickerOpen;
    this.renderInto();
  }

  /**
   * 選んだテンプレートを配置待ちにする（実際に置く場所は次に盤面をタップした位置
   * ——ユーザー指示により自由配置にした）。項目は空欄のままにし、後からテキスト道具でタップして
   * 書き込めるよう、道具をテキストに切り替えておく（ユーザー指示：項目はテンプレートを
   * 置いた後に設定できるようにしたい）。
   */
  private chooseTemplate(id: TemplateId): void {
    this.templatePickerOpen = false;
    this.setTool("text");
    this.onInsertTemplate?.(id);
  }

  private renderInto(): void {
    this.el.innerHTML = "";

    const pill = document.createElement("div");
    pill.className = "toolbar-pill";
    for (const tool of TOOL_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", TOOL_LABEL[tool]);
      btn.setAttribute("aria-pressed", String(this.tool === tool));
      btn.dataset.active = String(this.tool === tool);
      btn.innerHTML = ICONS[tool];
      btn.addEventListener("click", () => this.setTool(tool));
      pill.appendChild(btn);
    }
    this.el.appendChild(pill);

    if (this.tool === "text") {
      const stepper = document.createElement("div");
      stepper.className = "font-size-stepper";
      for (const step of FONT_SIZE_ORDER) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "font-size-btn";
        btn.textContent = FONT_SIZE_LABEL[step];
        btn.setAttribute("aria-label", `文字サイズ: ${FONT_SIZE_LABEL[step]}`);
        btn.setAttribute("aria-pressed", String(this.fontSizeStep === step));
        btn.style.opacity = this.fontSizeStep === step ? "1" : "0.4";
        btn.addEventListener("click", () => this.setFontSizeStep(step));
        stepper.appendChild(btn);
      }
      this.el.appendChild(stepper);
    }

    const swatchBtn = document.createElement("button");
    swatchBtn.type = "button";
    swatchBtn.className = "toolbar-swatch";
    swatchBtn.setAttribute("aria-label", "インクの色を選ぶ");
    swatchBtn.style.background = this.color;
    swatchBtn.appendChild(this.colorInput);
    swatchBtn.addEventListener("click", (ev) => {
      if (ev.target === this.colorInput) return;
      this.colorInput.click();
    });
    this.el.appendChild(swatchBtn);

    if (this.templatePickerOpen) {
      const picker = document.createElement("span");
      picker.className = "template-picker";
      for (const tpl of TEMPLATES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "text-link";
        btn.textContent = tpl.label;
        btn.addEventListener("click", () => this.chooseTemplate(tpl.id));
        picker.appendChild(btn);
      }
      this.el.appendChild(picker);
    } else {
      const templateBtn = document.createElement("button");
      templateBtn.type = "button";
      templateBtn.className = "icon-btn";
      templateBtn.setAttribute("aria-label", "テンプレートを置く");
      templateBtn.innerHTML = ICONS.checklist;
      templateBtn.addEventListener("click", () => this.toggleTemplatePicker());
      this.el.appendChild(templateBtn);
    }
  }
}
