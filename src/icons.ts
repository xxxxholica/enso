/**
 * ツールバー用の最小限のラインアイコン。一枚円の墨色と同じ線色・線幅で統一し、
 * Appleメモのような立体アイコンを模倣するのではなく、アプリ自身の紙とインクの
 * 世界観に合わせた抑えたタッチにしている。
 */

const common = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<"pen" | "marker" | "eraser" | "text" | "move" | "checklist", string> = {
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
  checklist: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M8.5 11l1.5 1.5L13 9" />
      <path d="M8.5 16l1.5 1.5L13 14" />
    </svg>`,
};
