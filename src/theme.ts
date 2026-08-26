import type { ThemePreference } from "./storage";

/**
 * テーマの指定をhtml要素のdata-theme属性に反映する。実際の色トークンの
 * 切り替え自体はstyle.cssの:root[data-theme="dark"]・
 * @media(prefers-color-scheme: dark)側で行う（このファイルはCSSに渡す
 * 属性を更新するだけで、色の値そのものは持たない）。
 * "system"はdata-theme属性を外す——style.css側の@media(prefers-color-scheme)
 * がOSの設定に従って自動で切り替わる。
 */
export function applyTheme(pref: ThemePreference): void {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = pref;
  }
}
