export interface DurationStep {
  label: string;
  ms: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 「消えるまでの期間」シークバー（時間選択ブロック）と、振り返りシークバーが
 * 共有する目盛り。8段階（15分〜3日）——引っかかりのある区切りでスライダーを
 * 止められるようにする（ユーザー指示）。
 *
 * 以前は7日までの9段階だったが、なぞって復活できる回数に上限を設けた
 * （Issue #11: メモが生涯になぞって回復できる合計時間は、自分の寿命ぶんまで）
 * のに合わせて、書き込み自体の寿命の上限も3日に短縮した（ユーザー指示）。
 * 振り返り側もこの配列をそのまま使う（以前は末尾の「7日」を除いて使っていたが、
 * 今はその「7日」自体が無いため、そのまま使うだけでよい。archiveView.ts参照）。
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
];
