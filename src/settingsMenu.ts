import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
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
 * あった「使い方」ボタンと、アカウント（ログイン・ログアウト自体はClerkの
 * ウィジェットがgetAccountSlot()の枠に描く、main.ts参照）もここに統合する。
 * 各区画は共有ルームメニュー(sharedRoomMenu.ts)と同じ.shared-menu-section/
 * .shared-section-labelパターンで区切る。
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
  private themeButtons = new Map<ThemePreference, HTMLButtonElement>();
  private accountSlot!: HTMLElement;

  constructor(container: HTMLElement, initialTheme: ThemePreference, onThemeChange: (pref: ThemePreference) => void) {
    this.theme = initialTheme;
    this.onThemeChange = onThemeChange;

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
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", THEME_LABEL[pref]);
      btn.innerHTML = THEME_ICON[pref];
      btn.addEventListener("click", () => this.selectTheme(pref));
      this.themeButtons.set(pref, btn);
      themeRow.appendChild(btn);
    }
    themeSection.appendChild(themeRow);
    this.popover.appendChild(themeSection);

    this.popover.appendChild(this.buildUsageSection());
    this.popover.appendChild(this.buildAccountSection());

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);

    this.syncTheme();
  }

  /** ヘッダーに独立してあった「使い方」ボタン（main.ts）をここに統合。
   *  再視聴時はonCloseを渡さない＝閉じた後にテンプレート選択へは続かない
   *  （main.ts側の初回フローと同じopenUsageGuideをただ呼ぶだけ）。 */
  private buildUsageSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "shared-menu-section";
    const label = document.createElement("div");
    label.className = "shared-section-label";
    label.textContent = "使い方";
    section.appendChild(label);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-btn";
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
