import { createFadeVisibility } from "./fadeVisibility";
import { ICONS } from "./icons";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS, type FontSizeStep } from "./textLayout";
import { PEN_WIDTH_RANGE } from "./toolStyle";
import type { TemplateId } from "./templates";
import type { DrawTool } from "./types";

export type ToolbarTool = DrawTool | "eraser" | "text" | "move" | "trace";

const DEFAULT_INK = "oklch(22% 0.012 55)";
/** ネイティブのカラーピッカーを開く初期値。実際の描画色は色を変更するまでこの近似値ではなくDEFAULT_INKのまま。 */
const COLOR_INPUT_SEED = "#2f2a26";

/** 消しゴムの当たり判定半径（画面px、キャンバスの大きさに関わらず一定）の
 *  スライダー範囲。以前は固定16px（旧ERASER_RADIUS_PX）だったが、GoodNotesの
 *  ようにバーで変えられるようにしたいというユーザー指示で調整可能にした。
 *  defaultの16pxは、その旧固定値と同じ。 */
const ERASER_RADIUS_RANGE = { min: 8, max: 40, step: 1, default: 16 } as const;

/** 鉛筆とペンはほぼ同じ機能（線を描くだけ）だったため1つに統合した（ユーザー指示）。
 *  「なぞる」は、なぞって復活させる操作がペン等の描画操作と混じりやすかったため、
 *  専用の道具として分離したもの（ユーザー指示）——「移動」道具と同じく、既存の
 *  メモに触れた場合だけ働き、何もない場所への新規作成はしない。 */
const TOOL_ORDER: ToolbarTool[] = ["pen", "marker", "text", "move", "trace", "eraser"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "選択",
  trace: "なぞる",
  eraser: "消しゴム",
};

const FONT_SIZE_ORDER: FontSizeStep[] = ["small", "medium", "large"];
const FONT_SIZE_LABEL: Record<FontSizeStep, string> = { small: "小", medium: "中", large: "大" };

/**
 * Appleメモ風の道具バー: ペン／マーカー／テキスト／移動／なぞる／消しゴムの切り替え、
 * テンプレート挿入、フルカラーのインク色選択をまとめて扱う（鉛筆とペンはほぼ同じ
 * 機能だったため1つに統合した——ユーザー指示）。
 * 「消えるまでの期間」はここでは扱わない（DurationSelectorが別軸・別ブロックで担当）。
 *
 * 下部バーは機能ごとに3ブロックへ分けており、このToolbarクラスはそのうち
 * 左と中央の2つを受け持つ（右の「時間選択ブロック」はDurationSelectorが別に
 * #duration-slotへ描画する）:
 *   - 左（.toolbar-tools）＝「ツール選択ブロック」: 道具アイコンとテンプレートを
 *     同じ1列（.toolbar-pill）に、すべて同じ大きさ（.toolbar-btn）で並べる。
 *     「何をするか」という操作そのものの並びとして、1つのブロックにまとめている
 *     （ユーザー指示：ツールを左に1ブロックとしてまとめたい）。
 *   - 中央（.toolbar-details）＝「ツールの詳細ブロック」: 色・サイズという、
 *     選んだ道具の見た目を決める設定。「サイズ」の小・中・大ステッパーは
 *     文字サイズ専用（テキスト道具用）。ペンの太さ・消しゴムの大きさは、
 *     GoodNotesのようにバーで連続的に選べるようにしたいというユーザー指示で
 *     別の1本のスライダー（buildThicknessSlider）に分けており、選んでいる
 *     道具がペンなら太さ、消しゴムなら大きさを表す（他の道具の間は無効化）。
 * 画面切り替えナビをヘッダー側に移した分フッターの横幅に余裕ができたため、
 * 以前は道具アイコンの上にposition: absoluteで浮かせていた詳細ブロックを
 * 通常のフローに戻し、ブロックを横に並べるだけで1行に収まるようにしている。
 *
 * テンプレートの選択自体はここでは扱わない（空のキャンバスから開く全画面の
 * テンプレート選択、templatePicker.ts）——このクラスはinsertTemplate()経由で
 * 「道具をテキストに切り替えてから盤面に置く」の橋渡しだけを担う。
 * 文字サイズのステッパーは道具に関わらず常に表示したままにしており、
 * 出入りのアニメーションは持たない
 * ——以前はテキスト道具のときだけ出し入れしていたが、その分バーの横幅が
 * 変わって2行に折り返ってしまうことがあったため、最初から常時表示にして
 * 横幅を固定した（ユーザー指示：絶対に2行にはしたくない）。
 *
 * DOMは初回に一度だけ組み立て、以降は状態が変わった箇所だけをピンポイントで
 * 更新する（innerHTMLを毎回作り直さない）。
 */
export class Toolbar {
  private el: HTMLElement;
  private container: HTMLElement;
  private onChange?: () => void;
  private onInsertTemplate?: (id: TemplateId) => void;
  private tool: ToolbarTool = "pen";
  private color: string = DEFAULT_INK;
  private fontSizeStep: FontSizeStep = DEFAULT_FONT_SIZE_STEP;
  private penWidth: number = PEN_WIDTH_RANGE.default;
  private eraserRadius: number = ERASER_RADIUS_RANGE.default;

  private toolButtons = new Map<ToolbarTool, HTMLButtonElement>();

  private stepperEl!: HTMLElement;
  private stepperButtons = new Map<FontSizeStep, HTMLButtonElement>();

  private thicknessWrap!: HTMLElement;
  private thicknessLabel!: HTMLElement;
  private thicknessSlider!: HTMLInputElement;

  private swatchBtn!: HTMLButtonElement;
  private colorInput!: HTMLInputElement;

  constructor(container: HTMLElement, onChange?: () => void, onInsertTemplate?: (id: TemplateId) => void) {
    this.container = container;
    this.onChange = onChange;
    this.onInsertTemplate = onInsertTemplate;

    this.el = document.createElement("div");
    // fade-visible: 画面切り替え時にこのバー全体がふわっとクロスフェードする
    // ためのクラス（main.tsが表示・非表示を切り替える。ユーザー指示）。
    this.el.className = "toolbar fade-visible";
    this.container.appendChild(this.el);

    this.buildTools();
    this.buildDetails();
    this.syncAll();
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

  /** 基準円(半径340px)におけるペンの線の太さ(px)。buildThicknessSliderのスライダーで
   *  選ぶ（道具がペンの間だけ有効）。実際の描画時はtoolStyle.toolRenderStyleで
   *  スケール・下限適用する。 */
  getLineWidth(): number {
    return this.penWidth;
  }

  /** 消しゴムの当たり判定半径(画面px)。buildThicknessSliderの同じスライダーで
   *  選ぶ（道具が消しゴムの間だけ有効）。canvasView.tsのeraseAt呼び出しで使う。 */
  getEraserRadius(): number {
    return this.eraserRadius;
  }

  private setTool(tool: ToolbarTool): void {
    this.tool = tool;
    this.syncAll();
    this.onChange?.();
  }

  private setFontSizeStep(step: FontSizeStep): void {
    this.fontSizeStep = step;
    this.syncStepper();
    this.onChange?.();
  }

  /**
   * 選んだテンプレートをそのまま盤面に置く（常に描画範囲の中心に、範囲全体を
   * 使う横幅で——ユーザー指示。位置を選ぶタップの手順は無い）。項目は空欄の
   * ままにし、後からテキスト道具でタップして書き込めるよう、道具をテキストに
   * 切り替えておく。
   *
   * 呼ぶのは空のキャンバスから開く全画面のテンプレート選択（templatePicker.ts、
   * 配線はmain.ts）。以前は道具バーのテンプレートボタン専用のprivateメソッドだったが、
   * 選ぶUI自体が道具バーの外へ出たためpublicにした。
   */
  insertTemplate(id: TemplateId): void {
    this.setTool("text");
    this.onInsertTemplate?.(id);
  }

  // --- 左ブロック（ツール選択ブロック）：道具アイコン＋テンプレートを1列に -----

  private buildTools(): void {
    const tools = document.createElement("div");
    tools.className = "toolbar-tools control-block";
    this.el.appendChild(tools);

    const pill = document.createElement("div");
    pill.className = "toolbar-pill";
    for (const tool of TOOL_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", TOOL_LABEL[tool]);
      btn.innerHTML = ICONS[tool];
      btn.addEventListener("click", () => this.setTool(tool));
      this.attachToolTooltip(btn, TOOL_LABEL[tool]);
      this.toolButtons.set(tool, btn);
      pill.appendChild(btn);
    }
    tools.appendChild(pill);
  }

  private syncPill(): void {
    for (const [tool, btn] of this.toolButtons) {
      const active = this.tool === tool;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  /** 道具ボタンにホバー用の小さな案内（ペン／マーカー／テキスト／選択／なぞる／
   *  消しゴム）を付ける（ユーザー指示）。既存のテンプレートメニュー等と同じ
   *  .icon-popoverの見た目・フェード（createFadeVisibility）をそのまま流用し、
   *  1単語だけの案内なので.tool-tooltipで詰まった見た目に整える。タッチでは
   *  「押さずに触れる」状態が無く、タップの前後にちらつくだけになってしまう
   *  ため、pointerType==="mouse"のときだけ働かせる（PCに限る、というユーザー
   *  指示。revive情報のホバー表示と同じ考え方）。 */
  private attachToolTooltip(btn: HTMLButtonElement, label: string): void {
    const tooltip = document.createElement("span");
    tooltip.className = "icon-popover tool-tooltip";
    tooltip.textContent = label;
    tooltip.hidden = true;
    btn.appendChild(tooltip);
    const setVisible = createFadeVisibility(tooltip);
    btn.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType === "mouse") setVisible(true);
    });
    btn.addEventListener("pointerleave", () => setVisible(false));
  }

  // --- 中央ブロック（ツールの詳細ブロック）：色・サイズ -----------------------

  private buildDetails(): void {
    const details = document.createElement("div");
    details.className = "toolbar-details control-block";
    this.el.appendChild(details);

    this.buildStepper(details);
    this.buildThicknessSlider(details);
    this.buildSwatch(details);
  }

  private buildStepper(details: HTMLElement): void {
    this.stepperEl = document.createElement("div");
    this.stepperEl.className = "font-size-stepper";
    for (const step of FONT_SIZE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "font-size-btn";
      btn.textContent = FONT_SIZE_LABEL[step];
      btn.setAttribute("aria-label", `サイズ: ${FONT_SIZE_LABEL[step]}`);
      btn.addEventListener("click", () => this.setFontSizeStep(step));
      this.stepperButtons.set(step, btn);
      this.stepperEl.appendChild(btn);
    }
    details.appendChild(this.stepperEl);
  }

  /**
   * サイズのステッパー（文字サイズ専用）は、道具に関わらず常に表示する
   * （以前はテキスト道具のときだけ出し入れしていたが、その分バーの横幅が
   * 変わって2行に折り返ってしまうことがあった。最初から全部出しておけば
   * 横幅は変わらない、というユーザー指示による）。テキスト道具でなくても、
   * 次にテキストを書くときのサイズを先に決めておける、と捉えれば自然な
   * 操作でもある。
   */
  private syncStepper(): void {
    for (const [step, btn] of this.stepperButtons) {
      const active = this.fontSizeStep === step;
      btn.setAttribute("aria-pressed", String(active));
      btn.style.opacity = active ? "1" : "0.4";
    }
  }

  /** ペンの太さ・消しゴムの大きさを1本のスライダーで共有する（ユーザー指示：
   *  GoodNotesのようにバーで変えたい）。物理量が違う2つの値を同じUI位置で
   *  切り替えるだけで、状態（penWidth/eraserRadius）はツールごとに別々に持つ
   *  ——ペンを太くしてから消しゴムに切り替えても、消しゴムの大きさは覚えたまま
   *  残る。ペン・消しゴム以外の道具の間は無効化する（DurationSelectorの
   *  setEnabledと同じ考え方——「サイズ」の文字ステッパーは道具を問わず常に
   *  有効なままにしているのとは対照的に、こちらは意味を持つ道具が2つしかない
   *  ため無効化する）。 */
  private buildThicknessSlider(details: HTMLElement): void {
    this.thicknessWrap = document.createElement("div");
    this.thicknessWrap.className = "thickness-control";

    this.thicknessLabel = document.createElement("span");
    this.thicknessLabel.className = "thickness-label";
    this.thicknessWrap.appendChild(this.thicknessLabel);

    this.thicknessSlider = document.createElement("input");
    this.thicknessSlider.type = "range";
    this.thicknessSlider.className = "thickness-slider";
    this.thicknessSlider.addEventListener("input", () => {
      const value = Number(this.thicknessSlider.value);
      if (this.tool === "eraser") {
        this.eraserRadius = value;
      } else {
        this.penWidth = value;
      }
      this.syncThicknessSlider();
      this.onChange?.();
    });
    this.thicknessWrap.appendChild(this.thicknessSlider);

    details.appendChild(this.thicknessWrap);
  }

  private syncThicknessSlider(): void {
    const isEraser = this.tool === "eraser";
    const enabled = isEraser || this.tool === "pen";
    const range = isEraser ? ERASER_RADIUS_RANGE : PEN_WIDTH_RANGE;
    const value = isEraser ? this.eraserRadius : this.penWidth;

    this.thicknessSlider.min = String(range.min);
    this.thicknessSlider.max = String(range.max);
    this.thicknessSlider.step = String(range.step);
    this.thicknessSlider.value = String(value);
    this.thicknessSlider.disabled = !enabled;
    this.thicknessSlider.setAttribute("aria-label", isEraser ? "消しゴムの大きさ" : "ペンの太さ");
    this.thicknessWrap.classList.toggle("thickness-control-disabled", !enabled);
    this.thicknessLabel.textContent = `${value}px`;
  }

  private buildSwatch(details: HTMLElement): void {
    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.value = COLOR_INPUT_SEED;
    this.colorInput.className = "toolbar-color-input";
    this.colorInput.setAttribute("aria-label", "インクの色を選ぶ");
    this.colorInput.addEventListener("input", () => {
      this.color = this.colorInput.value;
      this.syncSwatch();
      this.onChange?.();
    });

    this.swatchBtn = document.createElement("button");
    this.swatchBtn.type = "button";
    this.swatchBtn.className = "toolbar-swatch";
    this.swatchBtn.setAttribute("aria-label", "インクの色を選ぶ");
    this.swatchBtn.appendChild(this.colorInput);
    this.swatchBtn.addEventListener("click", (ev) => {
      if (ev.target === this.colorInput) return;
      this.colorInput.click();
    });
    details.appendChild(this.swatchBtn);
  }

  private syncSwatch(): void {
    this.swatchBtn.style.background = this.color;
  }

  private syncAll(): void {
    this.syncPill();
    this.syncStepper();
    this.syncThicknessSlider();
    this.syncSwatch();
  }
}
