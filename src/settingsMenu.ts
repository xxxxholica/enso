import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ExportSection, type ExportSource } from "./exportControl";
import { ICONS } from "./icons";
import type { ThemePreference } from "./storage";
import { openUsageGuide } from "./usageGuide";

// "custom"（好きな色を選ぶ）は固定の1色を持たないため、ここには含めず
// カラーパレット用のスワッチとして別に扱う（constructor参照）。
const THEME_ORDER: ("system" | "light" | "dark" | "sky")[] = ["system", "light", "dark", "sky"];
// テーマ選択は雫・葉のような形のアイコンではなく、道具バーのインク色スワッチ
// （.toolbar-swatch、円形に色を塗りつぶすだけの見た目）と同じ形式にする
// （ユーザー指摘：形で意味を持たせるのではなく、実際にそのテーマがどんな色味かを
// そのまま見せてほしい）。値はそのテーマの--paper-1（カード等の背景）と同じ
// oklchをそのまま使う——CSS変数は今のテーマでしか参照できないため、他のテーマの
// 色を見せるスワッチにはstyle.css/theme.ts側の値をここに直接コピーする必要がある。
// "system"だけは単色を持たないため、ライト/ダークの--paper-1を斜めに割った
// グラデーションで表す。"sky"はtheme.tsのSKY_HUE(=220度)をパステルの
// レシピ(buildPastelThemeVars)に通した時のpaper-1と同じ値。
const THEME_SWATCH_BACKGROUND: Record<"system" | "light" | "dark" | "sky", string> = {
  system: "linear-gradient(135deg, oklch(98% 0.005 75) 50%, oklch(35% 0.007 75) 50%)",
  light: "oklch(98% 0.005 75)",
  dark: "oklch(35% 0.007 75)",
  sky: "oklch(97% 0.015 220)",
};
const THEME_LABEL: Record<ThemePreference, string> = {
  system: "自動（端末の設定に従う）",
  light: "ライト",
  dark: "ダーク",
  sky: "水色",
  custom: "好きな色を選ぶ",
};

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
 * appearanceSelector.tsやsharedRoomMenu.tsは眼鏡キャンバスの下（下部バー）
 * に置かれるため上向き(.icon-popover既定)で開くが、これはヘッダー（画面
 * 上部）に置くため、画面外にはみ出さないよう下向き(.icon-popover--below)
 * で開く。
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
  private onCustomColorChange: (hex: string) => void;
  private themeButtons = new Map<ThemePreference, HTMLButtonElement>();
  /** カラーパレット（好きな色を選ぶ、issue #138）。道具バーのカスタムインク
   *  スワッチ（toolbar.ts）と同じ、円形ボタンの中に透明な<input type="color">
   *  を重ねて置く形——ボタンをクリックするとネイティブのカラーピッカーが開く。 */
  private customColorInput!: HTMLInputElement;
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
    initialCustomColor: string,
    onThemeChange: (pref: ThemePreference) => void,
    onCustomColorChange: (hex: string) => void,
    getExportSource: () => ExportSource | null,
    onOpenTemplatePicker: () => void
  ) {
    this.theme = initialTheme;
    this.onThemeChange = onThemeChange;
    this.onCustomColorChange = onCustomColorChange;
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
    this.popover.className = "settings-popover icon-popover icon-popover--below";
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

    // カラーパレット（好きな色を選ぶ、issue #138）。道具バーの「好きな色」
    // スワッチ（toolbar.ts）と全く同じ仕組み——透明な<input type="color">を
    // ボタンの上に重ね、ボタンのクリックをそのままネイティブのカラー
    // ピッカーへ橋渡しする。選ぶたびにtheme.tsが色相だけを取り出し、
    // パステルな配色一式(sky/customと同じレシピ)を組み立てて適用する。
    this.customColorInput = document.createElement("input");
    this.customColorInput.type = "color";
    this.customColorInput.value = initialCustomColor;
    this.customColorInput.className = "toolbar-color-input";
    this.customColorInput.setAttribute("aria-label", THEME_LABEL.custom);
    this.customColorInput.addEventListener("input", () => {
      const hex = this.customColorInput.value;
      this.customSwatchBtn.style.background = hex;
      this.onCustomColorChange(hex);
      if (this.theme !== "custom") {
        this.theme = "custom";
        this.syncTheme();
        this.onThemeChange("custom");
      }
    });

    this.customSwatchBtn = document.createElement("button");
    this.customSwatchBtn.type = "button";
    this.customSwatchBtn.className = "toolbar-swatch";
    this.customSwatchBtn.style.background = initialCustomColor;
    this.customSwatchBtn.setAttribute("aria-label", THEME_LABEL.custom);
    this.customSwatchBtn.appendChild(this.customColorInput);
    this.customSwatchBtn.addEventListener("click", (ev) => {
      if (ev.target === this.customColorInput) return;
      this.customColorInput.click();
    });
    this.themeButtons.set("custom", this.customSwatchBtn);
    themeRow.appendChild(this.customSwatchBtn);

    themeSection.appendChild(themeRow);
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
  }
}
