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
  | "eraserSizeSmall"
  | "eraserSizeMedium"
  | "eraserSizeLarge"
  | "text"
  | "move"
  | "trace"
  | "checklist"
  | "shapeRound"
  | "shapeOval"
  | "shapeSquare"
  | "sharedRooms"
  | "appearance"
  | "settings"
  | "themeSystem"
  | "themeLight"
  | "themeDark"
  | "patternMatte"
  | "patternTortoiseshell"
  | "patternClear"
  | "patternWood"
  | "trash"
  | "timer"
  | "room"
  | "undo"
  | "plus"
  | "link",
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
  // 消しゴムの大きさ（小/中/大）を選ぶボタン用。他のアイコンと違い、実際の大きさの
  // 違いをそのまま見せたいので線画ではなく丸にしている（GoodNotesの消しゴム
  // サイズ選択と同じ考え方——ユーザー指示）。中身をcurrentColorの塗りつぶし（黒っぽく
  // 見えてインクの色スウォッチと紛らわしい）にしていたが、「白色のモザイクのように」
  // という指摘を受け、白と薄いグレーの2x2の市松模様（モザイク）に変更した。
  // アイコンの実際の描画サイズが20x20pxしかなく、細かい市松模様にすると潰れて
  // ただの白い丸に見えてしまうため、円を4分割した粗いチェックにして小さくても
  // はっきり模様と分かるようにしている。紙のような明るい背景に対しても輪郭が
  // 見えるよう、丸の外周だけcurrentColorで縁取りしている。
  eraserSizeSmall: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-s"><circle cx="12" cy="12" r="3" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-s)">
        <rect x="9" y="9" width="6" height="6" fill="#ffffff" />
        <rect x="9" y="9" width="3" height="3" fill="var(--ink-35)" />
        <rect x="12" y="12" width="3" height="3" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>`,
  eraserSizeMedium: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-m"><circle cx="12" cy="12" r="5.5" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-m)">
        <rect x="6.5" y="6.5" width="11" height="11" fill="#ffffff" />
        <rect x="6.5" y="6.5" width="5.5" height="5.5" fill="var(--ink-35)" />
        <rect x="12" y="12" width="5.5" height="5.5" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>`,
  eraserSizeLarge: `
    <svg viewBox="0 0 24 24">
      <defs>
        <clipPath id="eraser-clip-l"><circle cx="12" cy="12" r="8.5" /></clipPath>
      </defs>
      <g clip-path="url(#eraser-clip-l)">
        <rect x="3.5" y="3.5" width="17" height="17" fill="#ffffff" />
        <rect x="3.5" y="3.5" width="8.5" height="8.5" fill="var(--ink-35)" />
        <rect x="12" y="12" width="8.5" height="8.5" fill="var(--ink-35)" />
      </g>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.2" />
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
  // 道具バーの「戻る」ボタン（issue #90）。反時計回りに巻き戻る矢印。
  undo: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M7 10L3 14L7 18" />
      <path d="M3 14H16C18.76 14 21 11.76 21 9C21 6.24 18.76 4 16 4H11" />
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
  // 「設定」トリガー用の歯車。外周のリングと太めの短い8本のスポークで、
  // sun（放射状の細い線のみ）と見分けが付くようにしている。
  settings: `
    <svg viewBox="0 0 24 24" ${common}>
      <circle cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="3" />
      <path
        stroke-width="2.2"
        d="M12 3.3v1.6M12 19.1v1.6M3.3 12h1.6M19.1 12h1.6M6.3 6.3l1.1 1.1M16.6 16.6l1.1 1.1M17.7 6.3l-1.1 1.1M7.4 16.6l-1.1 1.1"
      />
    </svg>`,
  // テーマ選択（自動/ライト/ダーク）の3アイコン。
  themeSystem: `
    <svg viewBox="0 0 24 24" ${common}>
      <rect x="3.5" y="5" width="17" height="12" rx="1.5" />
      <path d="M9 20h6M12 17v3" />
    </svg>`,
  themeLight: `
    <svg viewBox="0 0 24 24" ${common}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" />
    </svg>`,
  themeDark: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
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
  trash: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>`,
  // 共同アイデア出しセッション(sessionPanel.ts)のトリガーボタン用。
  timer: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M9 2h6" />
      <path d="M12 5v3" />
      <circle cx="12" cy="14" r="7" />
      <path d="M12 14V10" />
      <path d="M12 14l3.2 1.8" />
    </svg>`,
  // 接続中のルーム（sharedRoomMenu.ts）を表す小さな家のアイコン。IDの文字列
  // だけでは何を表しているボタンか分かりにくい、というユーザー指摘のため。
  room: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M4 11.5l8-7 8 7" />
      <path d="M6 10.2V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.8" />
      <path d="M10 20v-5h4v5" />
    </svg>`,
  // 「新しいルームを作成」(sharedRoomMenu.ts)用の単純な十字。
  plus: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>`,
  // 「共有URLをコピー」(sharedRoomMenu.ts)用の鎖の輪2つ。
  link: `
    <svg viewBox="0 0 24 24" ${common}>
      <path d="M10 6.5l1.3-1.3a3.5 3.5 0 0 1 5 5L15 11.5" />
      <path d="M14 17.5l-1.3 1.3a3.5 3.5 0 0 1-5-5L9 12.5" />
      <path d="M9.5 14.5l5-5" />
    </svg>`,
};
