import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ExportSection, type ExportSource } from "./exportControl";
import { ICONS } from "./icons";
import type { ThemePreference } from "./storage";
import { openUsageGuide } from "./usageGuide";

const THEME_ORDER: ThemePreference[] = ["system", "light", "dark"];
const THEME_ICON: Record<ThemePreference, string> = {
  system: ICONS.themeSystem,
  light: ICONS.themeLight,
  dark: ICONS.themeDark,
};
const THEME_LABEL: Record<ThemePreference, string> = {
  system: "自動（端末の設定に従う）",
  light: "ライト",
  dark: "ダーク",
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
  private themeButtons = new Map<ThemePreference, HTMLButtonElement>();
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
    onThemeChange: (pref: ThemePreference) => void,
    getExportSource: () => ExportSource | null,
    onOpenTemplatePicker: () => void
  ) {
    this.theme = initialTheme;
    this.onThemeChange = onThemeChange;
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
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", THEME_LABEL[pref]);
      btn.innerHTML = THEME_ICON[pref];
      btn.addEventListener("click", () => this.selectTheme(pref));
      this.themeButtons.set(pref, btn);
      themeRow.appendChild(btn);
    }
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
  }
}
