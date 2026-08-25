import { createFadeVisibility } from "./fadeVisibility";
import { ICONS } from "./icons";
import { DEFAULT_FONT_SIZE_STEP, FONT_SIZE_STEPS } from "./textLayout";
import { PEN_WIDTH_RANGE } from "./toolStyle";
import type { TemplateId } from "./templates";
import type { DrawTool } from "./types";

export type ToolbarTool = DrawTool | "eraser" | "text" | "move" | "trace";

export const DEFAULT_INK = "oklch(22% 0.012 55)";
/** ネイティブのカラーピッカーを開く初期値。実際の描画色は色を変更するまでこの近似値ではなくDEFAULT_INKのまま。 */
const COLOR_INPUT_SEED = "#2f2a26";

/** 消しゴムの当たり判定半径（画面px、キャンバスの大きさに関わらず一定）の
 *  小/中/大の3段階。以前はペンの太さと同じくバーで連続的に選べるようにして
 *  いたが、「GoodNotesのように消しゴムは3段階の大きさから選ぶ形にしたい」
 *  というユーザー指示を受け、細かい調整よりも一目で選べることを優先して
 *  3段階のボタン選択に変更した（ペンの太さは連続スライダーのまま）。
 *  値は変更前の連続スライダーのmin/default/maxをそのまま踏襲している。 */
const ERASER_SIZE_STEPS = { small: 8, medium: 16, large: 40 } as const;
type EraserSizeStep = keyof typeof ERASER_SIZE_STEPS;
const ERASER_SIZE_STEP_ORDER: EraserSizeStep[] = ["small", "medium", "large"];
const ERASER_SIZE_STEP_LABEL: Record<EraserSizeStep, string> = { small: "小", medium: "中", large: "大" };
const ERASER_SIZE_STEP_ICON: Record<EraserSizeStep, string> = {
  small: ICONS.eraserSizeSmall,
  medium: ICONS.eraserSizeMedium,
  large: ICONS.eraserSizeLarge,
};

interface InkPreset {
  id: string;
  label: string;
  color: string;
}

/** すぐ選べる固定インク3色（GoodNotes風の定番色、ユーザー指示）。ペン・
 *  テキストなど、マーカー以外の道具で使う。「黒」は既存の既定インク色
 *  （DEFAULT_INK）をそのまま使う——見た目・初期状態を変えないため。 */
const PEN_PRESET_INKS: InkPreset[] = [
  { id: "black", label: "黒", color: DEFAULT_INK },
  { id: "red", label: "赤", color: "oklch(52% 0.2 25)" },
  { id: "blue", label: "青", color: "oklch(48% 0.16 258)" },
];

/** マーカー専用の固定インク3色。マーカーでは黒はまず使わないだろう、という
 *  ユーザー指示により、ペン等とは別に色の三原色（CMY：シアン・マゼンタ・
 *  イエロー）を用意した。当初はペンの赤・青と同じ暗め・高彩度の値にしていたが、
 *  「濃すぎる、GoodNotesのようにもう少しパステル寄りにしたい」という指摘を
 *  受け、明度を上げ彩度を落として蛍光ペン・ハイライター寄りの淡い発色に
 *  調整した。 */
const MARKER_PRESET_INKS: InkPreset[] = [
  { id: "cyan", label: "シアン", color: "oklch(85% 0.08 210)" },
  { id: "magenta", label: "マゼンタ", color: "oklch(82% 0.11 340)" },
  { id: "yellow", label: "イエロー", color: "oklch(90% 0.1 95)" },
];

/** 鉛筆とペンはほぼ同じ機能（線を描くだけ）だったため1つに統合した（ユーザー指示）。
 *  「なぞる」は、なぞって復活させる操作がペン等の描画操作と混じりやすかったため、
 *  専用の道具として分離したもの（ユーザー指示）——「移動」道具と同じく、既存の
 *  メモに触れた場合だけ働き、何もない場所への新規作成はしない。
 *  "trace"はTOOL_ORDERから外して道具バーに出さないようにしている（ユーザー指示：
 *  選択道具の振り回し操作に統合したため。レビュー次第で復活させる可能性がある
 *  ため、道具そのもの・canvasView.ts側のなぞる処理は削除せず残している——
 *  再度表示したい場合はここに"trace"を戻すだけでよい）。 */
const TOOL_ORDER: ToolbarTool[] = ["pen", "marker", "text", "move", "eraser"];
const TOOL_LABEL: Record<ToolbarTool, string> = {
  pen: "ペン",
  marker: "マーカー",
  text: "テキスト",
  move: "選択",
  trace: "なぞる",
  eraser: "消しゴム",
};

/**
 * Appleメモ風の道具バー: ペン／マーカー／テキスト／移動／なぞる／消しゴムの切り替え、
 * テンプレート挿入、フルカラーのインク色選択をまとめて扱う（鉛筆とペンはほぼ同じ
 * 機能だったため1つに統合した——ユーザー指示）。
 * 「消えるまでの期間」は選べる仕様をやめ常に1日固定にしたため、ここでは扱わない
 * （fade.tsのFIXED_LIFESPAN_DAYS参照）。
 *
 * 下部バーは機能ごとに3ブロックへ分けており、このToolbarクラスはそのうち
 * 左と中央の2つを受け持つ（右のブロックは、旧「消えるまでの期間」選択の枠を
 * 転用した振り返りスライダー——RewindSelectorが別に#duration-slotへ描画する）:
 *   - 左（.toolbar-tools）＝「ツール選択ブロック」: 道具アイコンとテンプレートを
 *     同じ1列（.toolbar-pill）に、すべて同じ大きさ（.toolbar-btn）で並べる。
 *     「何をするか」という操作そのものの並びとして、1つのブロックにまとめている
 *     （ユーザー指示：ツールを左に1ブロックとしてまとめたい）。
 *   - 中央（.toolbar-details）＝「ツールの詳細ブロック」: 色・サイズという、
 *     選んだ道具の見た目を決める設定。文字サイズは選べる仕様をやめ常に
 *     DEFAULT_FONT_SIZE_STEP固定にしたため、ここでは扱わない（ユーザー指示：
 *     太さのスライダーが増えた分、サイズ選択のステッパー表示は不要）。
 *     ペンの太さは、GoodNotesのようにバーで連続的に選べるようにしたい
 *     というユーザー指示でスライダー（buildThicknessSlider）にしている。
 *     消しゴムの大きさは、当初はこのスライダーをペンと共有していたが、
 *     「GoodNotesのように消しゴムは3段階の大きさから選ぶ形にしたい」という
 *     ユーザー指示を受け、小/中/大の3段階のボタン選択（buildEraserSizeSteps）
 *     に分けた——選んでいる道具に応じて、この2つは同じ位置で片方だけを表示する。
 * 画面切り替えナビをヘッダー側に移した分フッターの横幅に余裕ができたため、
 * 以前は道具アイコンの上にposition: absoluteで浮かせていた詳細ブロックを
 * 通常のフローに戻し、ブロックを横に並べるだけで1行に収まるようにしている。
 *
 * テンプレートの選択自体はここでは扱わない（空のキャンバスから開く全画面の
 * テンプレート選択、templatePicker.ts）——このクラスはinsertTemplate()経由で
 * 「道具をテキストに切り替えてから盤面に置く」の橋渡しだけを担う。
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
  /** マーカー以外（ペン・テキスト等）で使う色。ペンの太さ・消しゴムの大きさが
   *  ツールごとに別々の値を覚えているのと同じ考え方で、マーカーの色
   *  （markerColor）とは独立して覚えておく——マーカーで色を変えても、
   *  ペンに戻したときの色は変わらない。 */
  private drawColor: string = DEFAULT_INK;
  /** マーカーで使う色。既定はMARKER_PRESET_INKSの1つ目（シアン）。 */
  private markerColor: string = MARKER_PRESET_INKS[0].color;
  private penWidth: number = PEN_WIDTH_RANGE.default;
  private eraserRadius: number = ERASER_SIZE_STEPS.medium;

  private toolButtons = new Map<ToolbarTool, HTMLButtonElement>();

  private thicknessWrap!: HTMLElement;
  private thicknessLabel!: HTMLElement;
  private thicknessSlider!: HTMLInputElement;
  /** 消しゴムの大きさ（小/中/大）を選ぶボタン。太さスライダーとは同じ
   *  .toolbar-details内の同じ位置を奪い合う形で、道具が消しゴムの時だけこちらを
   *  表示し、ペンの時だけスライダーを表示する（buildEraserSizeSteps参照）。 */
  private eraserSizeWrap!: HTMLElement;
  private eraserSizeButtons = new Map<EraserSizeStep, HTMLButtonElement>();

  /** 固定3スワッチのボタン本体。IDでなく位置（0〜2）で持つ——道具が
   *  マーカーかどうかでPEN_PRESET_INKS/MARKER_PRESET_INKSのどちらを表示するか
   *  が変わるため、ボタン自体は使い回し、中身（背景色・ラベル）をsyncSwatchで
   *  差し替える。 */
  private presetButtons: HTMLButtonElement[] = [];
  private customSwatchBtn!: HTMLButtonElement;
  private colorInput!: HTMLInputElement;
  private swatchRow!: HTMLElement;
  /** カスタムスワッチ（4つ目）で一度でも選んだ色。GoodNotes同様、選んだ色は
   *  そのスワッチ自体の色として残り続け、次回はクリックひとつで呼び戻せる。
   *  ペン・マーカーどちらで選んでも共有する1つの値（枠は増やさない）。 */
  private customColor: string | null = null;

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
    return this.tool === "marker" ? this.markerColor : this.drawColor;
  }

  /** 今の道具に応じて表示すべき固定3色（マーカーだけ色の三原色、それ以外は
   *  黒/赤/青）。 */
  private activePresetInks(): InkPreset[] {
    return this.tool === "marker" ? MARKER_PRESET_INKS : PEN_PRESET_INKS;
  }

  /** 今の道具用の色を更新する（マーカーならmarkerColor、それ以外はdrawColor）。 */
  private setActiveColor(color: string): void {
    if (this.tool === "marker") this.markerColor = color;
    else this.drawColor = color;
  }

  /** 基準円(半径340px)におけるフォントサイズ(px)。選べる仕様をやめ常にDEFAULT_FONT_SIZE_STEP
   *  固定にした（ユーザー指示）。実際の描画時はtextLayout.fontPxForRenderでスケール・下限適用する。 */
  getFontSize(): number {
    return FONT_SIZE_STEPS[DEFAULT_FONT_SIZE_STEP];
  }

  /** 基準円(半径340px)におけるペンの線の太さ(px)。buildThicknessSliderのスライダーで
   *  選ぶ（道具がペンの間だけ有効）。実際の描画時はtoolStyle.toolRenderStyleで
   *  スケール・下限適用する。 */
  getLineWidth(): number {
    return this.penWidth;
  }

  /** 消しゴムの当たり判定半径(画面px)。buildEraserSizeStepsの小/中/大の
   *  3段階から選ぶ（道具が消しゴムの間だけ表示・有効）。canvasView.tsの
   *  eraseAt呼び出しで使う。 */
  getEraserRadius(): number {
    return this.eraserRadius;
  }

  private setTool(tool: ToolbarTool): void {
    this.tool = tool;
    this.syncAll();
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

    this.buildThicknessSlider(details);
    this.buildEraserSizeSteps(details);
    this.buildSwatch(details);
  }

  /** ペンの太さをバーで連続的に選ぶ（ユーザー指示：GoodNotesのようにバーで
   *  変えたい）。消しゴムは別のUI（buildEraserSizeSteps、3段階のボタン選択）に
   *  分けている——「消しゴムはGoodNotesのように3段階の大きさから選ぶ形にしたい」
   *  というユーザー指示により、以前は太さスライダーをペン・消しゴムで共有して
   *  いたのをやめた。ペン以外（マーカー・テキスト・選択・消しゴム）の間は
   *  非表示にする——以前はグレーアウトして残していたが、「触れないバーが
   *  常に居座っているのは分かりにくい」という指摘を受け、意味を持つ道具が
   *  ペンだけになった今、消しゴムのカラーパレット非表示（syncSwatch参照）と
   *  同じ考え方で道具を問わず非表示にした。 */
  private buildThicknessSlider(details: HTMLElement): void {
    this.thicknessWrap = document.createElement("div");
    this.thicknessWrap.className = "thickness-control";

    this.thicknessLabel = document.createElement("span");
    this.thicknessLabel.className = "thickness-label";
    this.thicknessWrap.appendChild(this.thicknessLabel);

    this.thicknessSlider = document.createElement("input");
    this.thicknessSlider.type = "range";
    this.thicknessSlider.className = "thickness-slider";
    this.thicknessSlider.min = String(PEN_WIDTH_RANGE.min);
    this.thicknessSlider.max = String(PEN_WIDTH_RANGE.max);
    this.thicknessSlider.step = String(PEN_WIDTH_RANGE.step);
    this.thicknessSlider.setAttribute("aria-label", "ペンの太さ");
    this.thicknessSlider.addEventListener("input", () => {
      this.penWidth = Number(this.thicknessSlider.value);
      this.syncThicknessSlider();
      this.onChange?.();
    });
    this.thicknessWrap.appendChild(this.thicknessSlider);

    details.appendChild(this.thicknessWrap);
  }

  private syncThicknessSlider(): void {
    // ペン以外（マーカー・テキスト・選択・消しゴム）では意味を持たないため
    // 表示しない——以前はグレーアウトして残していたが、「触れないバーが
    // 常に居座っているのは分かりにくい」という指摘を受け、消しゴムの
    // カラーパレット非表示（syncSwatch参照）と同じ考え方で道具を問わず
    // 非表示にした。
    this.thicknessWrap.hidden = this.tool !== "pen";
    this.thicknessSlider.value = String(this.penWidth);
    this.thicknessLabel.textContent = `${this.penWidth}px`;
  }

  /** 消しゴムの大きさを小/中/大の3段階のボタンから選ぶ（ユーザー指示：GoodNotes
   *  のように3段階から選ぶ形にしたい——以前はペンと同じ連続スライダーを共有して
   *  いた）。フレーム形状・柄の選択（appearanceSelector.ts）と同じ.toolbar-pill/
   *  .toolbar-btnの見た目を流用し、選択中のボタンだけ塗りつぶしの丸が濃く見える
   *  ようdata-activeでハイライトする。道具が消しゴムの時だけ表示し、それ以外は
   *  隠す（syncThicknessSlider参照）。 */
  private buildEraserSizeSteps(details: HTMLElement): void {
    this.eraserSizeWrap = document.createElement("div");
    this.eraserSizeWrap.className = "toolbar-pill";

    for (const step of ERASER_SIZE_STEP_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", `消しゴムの大きさ: ${ERASER_SIZE_STEP_LABEL[step]}`);
      btn.innerHTML = ERASER_SIZE_STEP_ICON[step];
      btn.addEventListener("click", () => {
        this.eraserRadius = ERASER_SIZE_STEPS[step];
        this.syncEraserSizeSteps();
        this.onChange?.();
      });
      this.eraserSizeButtons.set(step, btn);
      this.eraserSizeWrap.appendChild(btn);
    }

    details.appendChild(this.eraserSizeWrap);
  }

  private syncEraserSizeSteps(): void {
    this.eraserSizeWrap.hidden = this.tool !== "eraser";
    for (const [step, btn] of this.eraserSizeButtons) {
      const active = ERASER_SIZE_STEPS[step] === this.eraserRadius;
      btn.dataset.active = String(active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  /**
   * インクの色: すぐ選べる固定3スワッチ＋4つ目の「好きな色」スワッチを横に
   * 並べる（ユーザー指示：GoodNotesのように定番色をすぐ選べるようにし、4つ目
   * でRGBの好きな色を選べるようにしたい）。固定3色は道具によって中身が変わる
   * （マーカーだけ色の三原色、それ以外は黒/赤/青——ユーザー指示：マーカーで
   * 黒はまず使わない）ため、ボタン自体は3つ作って使い回し、背景色・ラベルは
   * syncSwatchで今の道具に合わせて差し替える。
   */
  private buildSwatch(details: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "toolbar-swatches";
    this.swatchRow = row;

    for (let i = 0; i < 3; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-swatch";
      btn.addEventListener("click", () => {
        this.setActiveColor(this.activePresetInks()[i].color);
        this.syncSwatch();
        this.onChange?.();
      });
      this.presetButtons.push(btn);
      row.appendChild(btn);
    }

    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.value = COLOR_INPUT_SEED;
    this.colorInput.className = "toolbar-color-input";
    this.colorInput.setAttribute("aria-label", "好きな色を選ぶ（RGB）");
    this.colorInput.addEventListener("input", () => {
      this.customColor = this.colorInput.value;
      this.setActiveColor(this.customColor);
      this.syncSwatch();
      this.onChange?.();
    });

    // 未使用のうちは「好きな色」だと一目で分かるよう虹色の見た目にする
    // （style.cssの.toolbar-swatch--custom）。一度選んだ後は、その色そのものを
    // 背景に出す（インラインstyleがクラス由来の背景より優先される）。
    this.customSwatchBtn = document.createElement("button");
    this.customSwatchBtn.type = "button";
    this.customSwatchBtn.className = "toolbar-swatch toolbar-swatch--custom";
    this.customSwatchBtn.setAttribute("aria-label", "好きな色を選ぶ（RGB）");
    this.customSwatchBtn.appendChild(this.colorInput);
    this.customSwatchBtn.addEventListener("click", (ev) => {
      if (ev.target === this.colorInput) return;
      this.colorInput.click();
    });
    row.appendChild(this.customSwatchBtn);

    details.appendChild(row);
  }

  /** 今の道具の固定3色（activePresetInks）をスワッチの背景・ラベルに反映し、
   *  今の色（getColor）と一致するスワッチだけにリングを付けて選択中を示す
   *  （文字列比較でよい——色の値はすべてこのクラス自身が設定するため、ユーザー
   *  入力の表記ゆれを考慮する必要がない）。
   *  色を使わない道具（選択・消しゴム）を選んでいる間は、太さスライダー
   *  （syncThicknessSlider）と同じ考え方でパレット全体を無効化する——押しても
   *  意味を持たないボタンが常に押せる状態のままなのは分かりにくい（issue #68）。
   *  消しゴムの間はさらに一歩進めて非表示にする——消しゴムの大きさ選択
   *  （buildEraserSizeSteps）が同じ.toolbar-details内の見た目上の位置を使う
   *  ため、グレーアウトのまま残すと3段階ボタンの隣に無意味な色パレットが
   *  居座って見える（ユーザー指摘：消しゴムでは色の固定部分を表示しないでほしい）。 */
  private syncSwatch(): void {
    const enabled = this.tool === "pen" || this.tool === "marker" || this.tool === "text";
    this.swatchRow.hidden = this.tool === "eraser";
    const presets = this.activePresetInks();
    const color = this.getColor();
    let isPresetActive = false;
    presets.forEach((preset, i) => {
      const btn = this.presetButtons[i];
      btn.style.background = preset.color;
      btn.setAttribute("aria-label", `インクの色: ${preset.label}`);
      btn.disabled = !enabled;
      const active = preset.color === color;
      btn.dataset.active = String(active);
      if (active) isPresetActive = true;
    });
    this.customSwatchBtn.dataset.active = String(!isPresetActive);
    this.customSwatchBtn.disabled = !enabled;
    this.colorInput.disabled = !enabled;
    if (this.customColor) {
      this.customSwatchBtn.style.background = this.customColor;
    }
    this.swatchRow.classList.toggle("toolbar-swatches-disabled", !enabled);
  }

  private syncAll(): void {
    this.syncPill();
    this.syncThicknessSlider();
    this.syncEraserSizeSteps();
    this.syncSwatch();
  }

  /**
   * 振り返りスライダーで過去に遡っている間は道具を使えなくする（ユーザー指示：
   * 遡り中はグレーアウトでよい）。触れない・薄いことで無効だと分かるようにする、
   * という既存のDurationSelector/振り返りシークバーの無効表示と同じ考え方
   * （style.cssの.toolbar-disabled参照）。
   */
  setEnabled(enabled: boolean): void {
    this.el.classList.toggle("toolbar-disabled", !enabled);
  }

  /**
   * 共同アイデア出しセッションのフェーズ①②の間、色がセッション側から強制される
   * （実際に使われる色の上書きはsmuiView.tsが行う）。ここではスワッチ・カラー
   * ピッカーを押せなくして、触っても実際の色には反映されないことを示すだけ
   * （誤操作防止、ユーザーが「押したのに変わらない」と混乱しないため）。
   */
  setColorLocked(locked: boolean): void {
    for (const btn of this.presetButtons) btn.disabled = locked;
    this.customSwatchBtn.disabled = locked;
    this.colorInput.disabled = locked;
  }
}
