import type { ThemePreference } from "./storage";

/**
 * テーマの指定をhtml要素のdata-theme属性に反映する。system/light/darkの色
 * トークンは固定値のため、切り替え自体はstyle.cssの:root[data-theme="dark"]・
 * @media(prefers-color-scheme: dark)側で行う（このファイルはCSSに渡す属性を
 * 更新するだけで、色の値そのものは持たない）。"system"はdata-theme属性を外す
 * ——style.css側の@media(prefers-color-scheme)がOSの設定に従って自動で切り替わる。
 *
 * "sky"（水色プリセット）・"custom"（好きな色を選ぶ、issue #138）はこれとは別で、
 * 単色の色相からパステルな配色一式を導き出す必要があるため、CSSの固定値では
 * 表現できない——buildPastelThemeVars()でink-* や paper-*等をその場で計算し、
 * :rootへinline styleとして直接設定する。customColorHexはpref==="custom"の
 * 時だけ使う（他のprefでは無視してよい）。
 */
export function applyTheme(pref: ThemePreference, customColorHex?: string): void {
  const root = document.documentElement;
  if (pref === "sky" || pref === "custom") {
    const hue = pref === "custom" ? extractOklchHue(customColorHex ?? SKY_HUE_FALLBACK_COLOR) : SKY_HUE;
    applyPastelThemeVars(hue);
    root.dataset.theme = pref;
    return;
  }
  clearPastelThemeVars();
  if (pref === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = pref;
  }
}

/** 「水色」プリセットの色相（OKLCH、度）。 */
const SKY_HUE = 220;
/** カスタムカラーがまだ一度も保存されていない・不正な値だった場合のフォールバック
 *  （storage.tsのloadCustomThemeColorの既定値と同じ水色系）。 */
const SKY_HUE_FALLBACK_COLOR = "#7dd3fc";

/** パステルテーマ(sky/custom)で使うink-* / paper-* / rule-lineのCSSカスタム
 *  プロパティ名一覧。適用時はここに値を設定し、他のテーマへ切り替える時は
 *  ここを:root上から取り除く（inline styleはスタイルシートの値より常に優先
 *  されてしまうため、消し忘れると他のテーマにまで色が残ってしまう）。 */
const PASTEL_PROPERTY_NAMES = [
  "--ink-solid",
  "--ink-95",
  "--ink-85",
  "--ink-80",
  "--ink-70",
  "--ink-60",
  "--ink-55",
  "--ink-50",
  "--ink-45",
  "--ink-40",
  "--ink-35",
  "--ink-20",
  "--ink-12",
  "--ink-08",
  "--ink-06",
  "--paper-0",
  "--paper-1",
  "--paper-2",
  "--paper-2-hover",
  "--paper-3",
  "--paper-4",
  "--rule-line",
] as const;

/** 指定した色相(hue、OKLCH度)から、light/darkと同じ「インク1色＋紙の明度違い」
 *  の構造を保ったまま、Chromeのカスタムテーマのようなパステルな配色一式を
 *  機械的に導き出す。彩度・明度は固定のレシピで決め、色相だけを可変にする
 *  ——ユーザーがどんな色を選んでも、極端に濃い/薄い配色にならないようにするため。 */
function buildPastelThemeVars(hue: number): Record<(typeof PASTEL_PROPERTY_NAMES)[number], string> {
  const ink = (alpha?: number) => `oklch(30% 0.03 ${hue}${alpha !== undefined ? ` / ${alpha}` : ""})`;
  return {
    "--ink-solid": ink(),
    "--ink-95": ink(0.95),
    "--ink-85": ink(0.85),
    "--ink-80": ink(0.8),
    "--ink-70": ink(0.7),
    "--ink-60": ink(0.6),
    "--ink-55": ink(0.55),
    "--ink-50": ink(0.5),
    "--ink-45": ink(0.45),
    "--ink-40": ink(0.4),
    "--ink-35": ink(0.35),
    "--ink-20": ink(0.2),
    "--ink-12": ink(0.12),
    "--ink-08": ink(0.08),
    "--ink-06": ink(0.06),
    "--paper-0": `oklch(95% 0.02 ${hue})`,
    "--paper-1": `oklch(97% 0.015 ${hue})`,
    "--paper-2": `oklch(90% 0.025 ${hue})`,
    "--paper-2-hover": `oklch(90% 0.03 ${hue})`,
    "--paper-3": `oklch(85% 0.03 ${hue})`,
    "--paper-4": `oklch(86% 0.03 ${hue})`,
    "--rule-line": `oklch(70% 0.06 ${hue} / 0.4)`,
  };
}

function applyPastelThemeVars(hue: number): void {
  const vars = buildPastelThemeVars(hue);
  for (const name of PASTEL_PROPERTY_NAMES) {
    document.documentElement.style.setProperty(name, vars[name]);
  }
}

function clearPastelThemeVars(): void {
  for (const name of PASTEL_PROPERTY_NAMES) {
    document.documentElement.style.removeProperty(name);
  }
}

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** #rrggbb形式の色から、OKLCH色空間での色相(hue、度、0〜360)だけを取り出す。
 *  ChromeのカスタムテーマUIと同じく、選んだ色そのままの明度・彩度は使わず
 *  （buildPastelThemeVars参照）色相だけを借りるため、L/Cは計算しない。
 *  計算式はBjörn OttossonのOKLab変換をそのまま使用（sRGB→線形RGB→LMS→OKLab→
 *  OKLCHの色相）。 */
function extractOklchHue(hex: string): number {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  const normalized = match ? match[1] : "7dd3fc";
  const r = srgbChannelToLinear(parseInt(normalized.slice(0, 2), 16) / 255);
  const g = srgbChannelToLinear(parseInt(normalized.slice(2, 4), 16) / 255);
  const b = srgbChannelToLinear(parseInt(normalized.slice(4, 6), 16) / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  if (Math.abs(a) < 1e-6 && Math.abs(bLab) < 1e-6) return SKY_HUE;
  const hueRad = Math.atan2(bLab, a);
  const hueDeg = (hueRad * 180) / Math.PI;
  return hueDeg < 0 ? hueDeg + 360 : hueDeg;
}
