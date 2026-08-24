/**
 * ツールバー用の最小限のラインアイコン。一枚円の墨色と同じ線色・線幅で統一し、
 * Appleメモのような立体アイコンを模倣するのではなく、アプリ自身の紙とインクの
 * 世界観に合わせた抑えたタッチにしている。
 */

const common = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<
  | "pen"
  | "marker"
  | "eraser"
  | "text"
  | "move"
  | "trace"
  | "checklist"
  | "shapeRound"
  | "shapeOval"
  | "shapeSquare"
  | "sharedRooms"
  | "appearance"
  | "patternMatte"
  | "patternTortoiseshell"
  | "patternClear"
  | "patternWood",
  string
> = {
  pen: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M5 19.5l0.6-3 11-11 2.4 2.4-11 11z" />
      <path d="M15.6 6.5l1.9-1.9a1.4 1.4 0 0 1 2 0l0.9 0.9a1.4 1.4 0 0 1 0 2l-1.9 1.9z" />
      <path d="M5 19.5l3-0.6" />
    </svg>`,
  marker: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M9 20h6" />
      <path d="M8.5 20l-0.4-4.2 3-9.3a1 1 0 0 1 1.9 0l3 9.3-0.4 4.2z" />
      <path d="M8.4 12.5h7.2" />
    </svg>`,
  eraser: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M9.5 19h9" />
      <path d="M6.2 15.3l7-7 4.5 4.5-5.3 5.2H9z" />
      <path d="M13.2 8.3l-4-4a1.5 1.5 0 0 0-2.1 0l-3 3a1.5 1.5 0 0 0 0 2.1l4 4" />
    </svg>`,
  text: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M5 6.5h14" />
      <path d="M12 6.5v11" />
      <path d="M9 17.5h6" />
    </svg>`,
  move: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M12 4v16" />
      <path d="M4 12h16" />
      <path d="M9 7l3-3 3 3" />
      <path d="M9 17l3 3 3-3" />
      <path d="M7 9l-3 3 3 3" />
      <path d="M17 9l3 3-3 3" />
    </svg>`,
  trace: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M3.5 15c2.5-6 5-6 7-3s4.5 3 7-3" stroke-dasharray="2.2 3" opacity="0.55" />
      <path d="M12.7 11.3c1-1.5 2.2-1.9 3.3-1.3" />
      <circle cx="17.5" cy="8.3" r="1.6" fill="currentColor" stroke="none" />
    </svg>`,
  checklist: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M8.5 11l1.5 1.5L13 9" />
      <path d="M8.5 16l1.5 1.5L13 14" />
    </svg>`,
  shapeRound: `
    <svg viewBox="0 0 24 24" ${common}>
      <circle cx="12" cy="12" r="8" />
    </svg>`,
  shapeOval: `
    <svg viewBox="0 0 24 24" ${common}>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
    </svg>`,
  shapeSquare: `
    <svg viewBox="0 0 24 24" ${common}>
      <rect x="4" y="5" width="16" height="14" rx="3.5" />
    </svg>`,
  sharedRooms: `
    <svg viewBox="0 0 24 24" ${common}>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </svg>`,
  appearance: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M9 4L4 7.5L6.5 10.5L9 8.5V20H15V8.5L17.5 10.5L20 7.5L15 4H14C14 5.38 13.1 6.4 12 6.4C10.9 6.4 10 5.38 10 4Z" />
    </svg>`,
  // 柄・質感の4アイコンは、既存のライン系アイコンと違い形ではなく質感そのものの
  // プレビューなので、線でなく塗りのスワッチとして描く（common属性は使わない）。
  patternMatte: `
    <svg viewBox="0 0 24 24">
      <defs>
        <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="oklch(25% 0.02 55)" />
          <stop offset="0.5" stop-color="oklch(36% 0.022 55)" />
          <stop offset="1" stop-color="oklch(25% 0.02 55)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#pm-g)" />
    </svg>`,
  patternTortoiseshell: `
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="oklch(46% 0.09 70)" />
      <ellipse cx="8" cy="8" rx="4" ry="3" transform="rotate(20 8 8)" fill="oklch(20% 0.03 50)" opacity="0.55" />
      <ellipse cx="16" cy="9" rx="3.2" ry="2.4" transform="rotate(-15 16 9)" fill="oklch(28% 0.07 40)" opacity="0.6" />
      <ellipse cx="7" cy="16" rx="3.5" ry="2.6" transform="rotate(-10 7 16)" fill="oklch(30% 0.08 45)" opacity="0.5" />
      <ellipse cx="16" cy="16.5" rx="4" ry="3" transform="rotate(15 16 16.5)" fill="oklch(18% 0.02 40)" opacity="0.6" />
    </svg>`,
  patternClear: `
    <svg viewBox="0 0 24 24">
      <defs>
        <linearGradient id="pc-g" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stop-color="oklch(80% 0.03 90 / 0.6)" />
          <stop offset="0.35" stop-color="oklch(97% 0.015 95 / 0.9)" />
          <stop offset="0.5" stop-color="oklch(72% 0.035 90 / 0.55)" />
          <stop offset="0.7" stop-color="oklch(97% 0.015 95 / 0.9)" />
          <stop offset="1" stop-color="oklch(80% 0.03 90 / 0.6)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#pc-g)" stroke="oklch(60% 0.03 90 / 0.5)" stroke-width="1" />
    </svg>`,
  patternWood: `
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="oklch(53% 0.07 60)" />
      <path d="M3 8c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(32% 0.06 50)" stroke-width="1.1" opacity="0.55" />
      <path d="M3 13c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(38% 0.07 55)" stroke-width="1.3" opacity="0.5" />
      <path d="M3 18c3-2 6 2 9 0s6-2 9 0" fill="none" stroke="oklch(30% 0.05 45)" stroke-width="1" opacity="0.5" />
    </svg>`,
};
