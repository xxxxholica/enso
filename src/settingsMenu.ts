import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { ICONS } from "./icons";
import type { ThemePreference } from "./storage";

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
 * 機能を入れたい）。今のところ中身はテーマ（自動/ライト/ダーク）1区画のみ
 * だが、他の見た目の設定（appearanceSelector.ts）と同じ.icon-anchor/
 * .icon-popoverパターンにしておくことで、今後設定項目が増えても同じ形で
 * 区画（.shared-menu-section）を追加していける。
 *
 * appearanceSelector.tsやsharedRoomMenu.tsは眼鏡キャンバスの下（下部バー）
 * に置かれるため上向き(.icon-popover既定)で開くが、これはヘッダー（画面
 * 上部）に置くため、画面外にはみ出さないよう下向き(.icon-popover--below)
 * で開く。
 */
export class SettingsMenu {
  private triggerBtn: HTMLButtonElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  private theme: ThemePreference;
  private onThemeChange: (pref: ThemePreference) => void;
  private themeButtons = new Map<ThemePreference, HTMLButtonElement>();

  constructor(container: HTMLElement, initialTheme: ThemePreference, onThemeChange: (pref: ThemePreference) => void) {
    this.theme = initialTheme;
    this.onThemeChange = onThemeChange;

    const anchor = document.createElement("div");
    anchor.className = "icon-anchor";

    this.triggerBtn = document.createElement("button");
    this.triggerBtn.type = "button";
    this.triggerBtn.className = "pill-btn settings-trigger";
    this.triggerBtn.setAttribute("aria-label", "設定");
    this.triggerBtn.innerHTML = `${ICONS.settings}<span>設定</span>`;
    this.triggerBtn.addEventListener("click", () => this.toggle());
    anchor.appendChild(this.triggerBtn);

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

    anchor.appendChild(this.popover);
    container.appendChild(anchor);

    this.syncTheme();
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    notifyOpen(this.closeRef);
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
