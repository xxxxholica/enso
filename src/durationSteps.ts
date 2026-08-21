export interface DurationStep {
  label: string;
  ms: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 「消えるまでの期間」シークバー（時間選択ブロック）と、振り返りシークバーが
 * 共有する目盛り。9段階（15分〜7日）——引っかかりのある区切りでスライダーを
 * 止められるようにする（ユーザー指示）。
 *
 * 振り返り側は検索性を意図的に下げるための上限（3日）があるため、末尾の
 * 「7日」を除いた8段階だけを使う（archiveView.tsのARCHIVE_STEPS参照）。
 * こちらの「消えるまでの期間」側は上限なく全9段階を使う。
 */
export const DURATION_STEPS: DurationStep[] = [
  { label: "15分", ms: 15 * MINUTE },
  { label: "30分", ms: 30 * MINUTE },
  { label: "1時間", ms: 1 * HOUR },
  { label: "3時間", ms: 3 * HOUR },
  { label: "6時間", ms: 6 * HOUR },
  { label: "12時間", ms: 12 * HOUR },
  { label: "1日", ms: 1 * DAY },
  { label: "3日", ms: 3 * DAY },
  { label: "7日", ms: 7 * DAY },
];
