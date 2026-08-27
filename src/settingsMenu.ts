import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ExportSection, type ExportSource } from "./exportControl";
import { ICONS } from "./icons";
import type { ThemePreference } from "./storage";
import { openUsageGuide } from "./usageGuide";

// "custom"（好きな色を選ぶ）は固定の1色を持たないため、ここには含めず
// カラーパレット用のスワッチとして別に扱う（constructor参照）。
const THEME_ORDER: ("system" | "light" | "dark")[] = ["system", "light", "dark"];
// テーマ選択は雫・葉のような形のアイコンではなく、道具バーのインク色スワッチ
// （.toolbar-swatch、円形に色を塗りつぶすだけの見た目）と同じ形式にする
// （ユーザー指摘：形で意味を持たせるのではなく、実際にそのテーマがどんな色味かを
// そのまま見せてほしい）。値はそのテーマの--paper-1（カード等の背景）と同じ
// oklchをそのまま使う——CSS変数は今のテーマでしか参照できないため、他のテーマの
// 色を見せるスワッチにはstyle.css側の値をここに直接コピーする必要がある。
// "system"だけは単色を持たないため、ライト/ダークの--paper-1を斜めに割った
// グラデーションで表す。
const THEME_SWATCH_BACKGROUND: Record<"system" | "light" | "dark", string> = {
  system: "linear-gradient(135deg, oklch(98% 0.005 75) 50%, oklch(35% 0.007 75) 50%)",
  light: "oklch(98% 0.005 75)",
  dark: "oklch(35% 0.007 75)",
};
const THEME_LABEL: Record<ThemePreference, string> = {
  system: "自動（端末の設定に従う）",
  light: "ライト",
  dark: "ダーク",
  custom: "好きな色を選ぶ",
};
/** カラーパレット（好きな色を選ぶ）のプレビュースワッチに使う色。実際に
 *  適用されるパステルな--paper-1相当の色（oklch(97% 0.015 hue)、他の固定
 *  テーマスワッチと同じ式）を使うと、custom テーマが有効な間はポップオーバー
 *  自体の背景（--paper-1）とほぼ同じ色になり、スワッチが背景に溶けて見えなく
 *  なっていた（ユーザー指摘）。バー(.theme-hue-slider)のトラックと同じ
 *  鮮やかさ(oklch(75% 0.15 hue))にして、どのテーマが有効でもスワッチ自体が
 *  周囲から独立して見えるようにする。 */
function customSwatchBackground(hue: number): string {
  return `oklch(75% 0.15 ${hue})`;
}

/**
 * ヘッダーの「設定」ボタン（ユーザー指示：設定ボタンを追加してテーマ変更
 * 機能を入れたい）。テーマ（自動/ライト/ダーク）に加え、ヘッダーに個別に
 * あった「使い方」ボタン・エクスポート機能、アカウント（ログイン・ログアウト
 * 自体はClerkのウィジェットがgetAccountSlot()の枠に描く、main.ts参照）も
 * ここに統合する。各区画は共有ルームメニュー(sharedRoomMenu.ts)と同じ
 * .shared-menu-section/.shared-section-labelパターンで区切るが、区画数が
 * 増えて仕切り線が煩雑になったため、この設定ポップオーバー内に限り
 * 仕切り線(border-top)だけをCSS側で打ち消している（余白は残す）。
 *
 * トリガーはアイコンのみ（ユーザー指示）——「設定」の文字はaria-labelで
 * スクリーンリーダーにだけ伝える。
 *
 * 個人キャンバス（#canvas-info-row）・共有キャンバス（smuiView.tsのroomMenuRow）
 * どちらの下部バーにも置かれうる（moveTo参照、ユーザー指示：設定ボタンを
 * ヘッダーから各タブの操作列へ移したい）ため、appearanceSelector.ts等と同じく
 * 上向き(.icon-popover既定)で開く。
 */
export class SettingsMenu {
  private anchor: HTMLElement;
  private triggerBtn: HTMLButtonElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  private theme: ThemePreference;
  private onThemeChange: (pref: ThemePreference) => void;
  private onCustomHueChange: (hue: number) => void;
  private themeButtons = new Map<ThemePreference, HTMLButtonElement>();
  /** カラーパレット（好きな色を選ぶ、issue #138）。ネイティブのカラー
   *  ピッカー（RGB数値等が出てくる）ではなく、Chromeのテーマ設定と同じ
   *  横1本の色相グラデーションバー（ユーザー指示）——虹色の帯を左右にドラッグ
   *  するだけで選べる。値は0〜360度のOKLCH色相のみ（RGBは一切経由しない）。 */
  private hueSlider!: HTMLInputElement;
  /** バーで選んだ色を映す円形スワッチ（他のテーマスワッチと同じ.toolbar-swatch）。
   *  バーを動かすたびcustomSwatchBackground()で背景色を更新する
   *  （ユーザー指摘：バーで色を変えてもスワッチの見た目が追従していなかった）。 */
  private customSwatchBtn!: HTMLButtonElement;
  private accountSlot!: HTMLElement;

  private onOpenTemplatePicker: () => void;
  /** 「テンプレート」区画本体。共有タブでは出さない（issue #79ユーザー指示：
   *  テンプレート挿入は個人キャンバス専用で、選ぶ画面自体もタブ切り替え不可の
   *  全画面の幕のため、開いた時点のタブが「今表示中の画面」として固定される）
   *  ため、main.ts側のsetView()からsetTemplateSectionVisible()経由で
   *  画面切り替えのたび出し分ける。 */
  private templateSection!: HTMLElement;

  constructor(
    container: HTMLElement,
    initialTheme: ThemePreference,
    initialCustomHue: number,
    onThemeChange: (pref: ThemePreference) => void,
    onCustomHueChange: (hue: number) => void,
    getExportSource: () => ExportSource | null,
    onOpenTemplatePicker: () => void
  ) {
    this.theme = initialTheme;
    this.onThemeChange = onThemeChange;
    this.onCustomHueChange = onCustomHueChange;
    this.onOpenTemplatePicker = onOpenTemplatePicker;

    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.triggerBtn = document.createElement("button");
    this.triggerBtn.type = "button";
    this.triggerBtn.className = "pill-btn settings-trigger";
    this.triggerBtn.setAttribute("aria-label", "設定");
    this.triggerBtn.innerHTML = ICONS.settings;
    this.triggerBtn.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.triggerBtn);

    this.popover = document.createElement("div");
    this.popover.className = "settings-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    const themeSection = document.createElement("div");
    themeSection.className = "shared-menu-section";
    const themeLabel = document.createElement("div");
    themeLabel.className = "shared-section-label";
    themeLabel.textContent = "テーマ";
    themeSection.appendChild(themeLabel);
    const themeRow = document.createElement("div");
    themeRow.className = "toolbar-pill";
    for (const pref of THEME_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      // 道具バーのインク色スワッチと同じ.toolbar-swatchクラスを使い、円形に
      // そのテーマの色を塗りつぶすだけの見た目にする（雫・葉などの意味付け
      // アイコンではなく、実際の色そのもので選ばせる）。
      btn.className = "toolbar-swatch";
      btn.style.background = THEME_SWATCH_BACKGROUND[pref];
      btn.setAttribute("aria-label", THEME_LABEL[pref]);
      btn.addEventListener("click", () => this.selectTheme(pref));
      this.themeButtons.set(pref, btn);
      themeRow.appendChild(btn);
    }

    // カラーパレットのプレビュースワッチ（好きな色を選ぶ、issue #138）。
    // 他の固定テーマと同じ.toolbar-swatchの円で、下のバーで選んだ色を
    // その場で反映する（ユーザー指摘：バーを動かしてもスワッチの見た目が
    // 追従していなかった）。クリックでも"custom"テーマを選べる——バーで
    // 既に選んだ色相のまま戻したい場合の入口として。
    this.customSwatchBtn = document.createElement("button");
    this.customSwatchBtn.type = "button";
    this.customSwatchBtn.className = "toolbar-swatch";
    this.customSwatchBtn.style.background = customSwatchBackground(initialCustomHue);
    this.customSwatchBtn.setAttribute("aria-label", THEME_LABEL.custom);
    this.customSwatchBtn.addEventListener("click", () => this.selectTheme("custom"));
    this.themeButtons.set("custom", this.customSwatchBtn);
    themeRow.appendChild(this.customSwatchBtn);

    themeSection.appendChild(themeRow);

    // カラーパレット本体（好きな色を選ぶ、issue #138）。ネイティブの<input
    // type="color">（RGB数値・16進入力等が出てくる）ではなく、Chromeの
    // テーマ設定と同じ横1本の色相グラデーションバー（ユーザー指示）——
    // <input type="range">に虹色のグラデーションを描くだけで、ドラッグ・
    // タップ・キーボード操作（矢印キー）が素のまま使える。値は0〜360度の
    // OKLCH色相のみで、選ぶたびにtheme.tsのbuildPastelThemeVarsがパステルな
    // 配色一式を組み立てて適用する。
    this.hueSlider = document.createElement("input");
    this.hueSlider.type = "range";
    this.hueSlider.min = "0";
    this.hueSlider.max = "360";
    this.hueSlider.step = "1";
    this.hueSlider.value = String(initialCustomHue);
    this.hueSlider.className = "theme-hue-slider";
    this.hueSlider.setAttribute("aria-label", THEME_LABEL.custom);
    this.hueSlider.addEventListener("input", () => {
      const hue = Number(this.hueSlider.value);
      this.customSwatchBtn.style.background = customSwatchBackground(hue);
      this.onCustomHueChange(hue);
      if (this.theme !== "custom") {
        this.theme = "custom";
        this.syncTheme();
        this.onThemeChange("custom");
      }
    });
    themeSection.appendChild(this.hueSlider);

    this.popover.appendChild(themeSection);

    this.popover.appendChild(this.buildTemplateSection());
    this.popover.appendChild(this.buildUsageSection());
    this.popover.appendChild(new ExportSection(getExportSource, () => this.close()).element);
    this.popover.appendChild(this.buildAccountSection());

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);

    this.syncTheme();
  }

  /** 「＋テンプレートを使用」（全画面のテンプレート選択、templatePicker.ts）を開く。
   *  空キャンバス中央の案内・道具バーと、目立たせる位置をいくつか試した末に、
   *  常設の操作というより頻度の低い呼び出しとして設定メニューへ落ち着けた
   *  （ユーザー指示）。テーマ行・使い方と同じ.shared-menu-section/
   *  .shared-section-labelパターンで区切る。 */
  private buildTemplateSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "shared-menu-section";
    const label = document.createElement("div");
    label.className = "shared-section-label";
    label.textContent = "テンプレート";
    section.appendChild(label);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn settings-template-btn";
    btn.textContent = "テンプレートを使用";
    btn.addEventListener("click", () => {
      this.close();
      this.onOpenTemplatePicker();
    });
    section.appendChild(btn);
    this.templateSection = section;
    return section;
  }

  /** ヘッダーに独立してあった「使い方」ボタン（main.ts）をここに統合。
   *  再視聴時はonCloseを渡さない＝閉じた後にテンプレート選択へは続かない
   *  （main.ts側の初回フローと同じopenUsageGuideをただ呼ぶだけ）。
   *  テーマ行と左右の余白が揃うよう、幅いっぱいに広げる（ユーザー指示）。 */
  private buildUsageSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "shared-menu-section";
    const label = document.createElement("div");
    label.className = "shared-section-label";
    label.textContent = "使い方";
    section.appendChild(label);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn settings-usage-btn";
    btn.textContent = "使い方を見る";
    btn.addEventListener("click", () => {
      this.close();
      openUsageGuide();
    });
    section.appendChild(btn);
    return section;
  }

  /** アカウント区画。ヘッダー独立だったClerkウィジェット（account-slot）を
   *  ここへ丸ごと移設する——このクラス自身はClerkの詳細を知らず、
   *  clerkAccount.tsのmountAccountWidget()が実際の中身（未ログイン時の
   *  ログインボタン／ログイン中のユーザーアイコン・メニュー）を後から
   *  このスロットへ描き込む（main.ts参照）。 */
  private buildAccountSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "shared-menu-section";
    const label = document.createElement("div");
    label.className = "shared-section-label";
    label.textContent = "アカウント";
    section.appendChild(label);

    this.accountSlot = document.createElement("div");
    this.accountSlot.className = "settings-account-slot";
    section.appendChild(this.accountSlot);

    return section;
  }

  /** mountAccountWidget()の描画先。main.ts側で、このインスタンスの生成後に呼ぶ。 */
  getAccountSlot(): HTMLElement {
    return this.accountSlot;
  }

  /** 共有タブでは「テンプレート」区画を出さない（issue #79ユーザー指示）。
   *  設定メニュー自体はキャンバス・共有どちらのタブからも開けるため、
   *  main.tsのsetView()から画面切り替えのたび呼んで出し分ける。 */
  setTemplateSectionVisible(visible: boolean): void {
    this.templateSection.hidden = !visible;
  }

  /** タブ切り替え(main.tsのsetView())のたび、今表示中のタブの操作列へこの
   *  ボタン自体(アカウント区画・Clerkウィジェットも含めて丸ごと)を移す。
   *  インスタンスは1個のまま(アカウント区画のmountAccountWidgetはClerk
   *  クライアントを新規生成する副作用があり、2個目を作ると二重初期化に
   *  なるため——main.ts参照)、DOM上の置き場所だけをappendChildで動かす。 */
  moveTo(container: HTMLElement): void {
    this.close(); // 開いたまま移動すると新しい場所で唐突に開いて見える
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

  private selectTheme(pref: ThemePreference): void {
    if (pref === this.theme) return;
    this.theme = pref;
    this.syncTheme();
    this.onThemeChange(pref);
  }

  private syncTheme(): void {
    for (const [pref, btn] of this.themeButtons) {
      const active = pref === this.theme;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
    // カラーパレットのバーは、他のテーマ選択中は不要な操作が常設で見えて
    // しまう（ユーザー指摘）ため、"custom"を選んでいる間だけ出す——
    // プレビュースワッチをクリックするだけでも"custom"に切り替わり、バーが
    // 現れる（最後に選んだ色相のまま再開できる）。
    this.hueSlider.hidden = this.theme !== "custom";
  }
}
