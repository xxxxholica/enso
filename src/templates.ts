export type TemplateId = "checklist" | "phoneMemo" | "buyList" | "outline";

export interface TemplateDef {
  id: TemplateId;
  /** 道具バーの選択肢に出す短い名前。 */
  label: string;
  /** 盤面に置く文面。項目は空欄のままにし、置いた後にテキスト道具でタップして書き込む。 */
  text: string;
}

/**
 * 盤面にそのまま置けるテンプレート一覧。道具バーのテンプレートボタンを押すと、
 * ここに並んだ選択肢からどちらかを選ぶ（ユーザー指示）。
 */
export const TEMPLATES: TemplateDef[] = [
  { id: "checklist", label: "持ち物チェック", text: "持ち物チェック\n□ \n□ \n□ \n□ \n□ " },
  { id: "phoneMemo", label: "電話メモ", text: "電話メモ\n名前: \n日付: \n要件: \n電話番号: " },
  { id: "buyList", label: "買い物リスト", text: "買い物リスト\nスーパー\n・  \nドラッグストア\n・  \nその他\n・  " },
  {
    id: "outline",
    label: "新しいテーマ",
    text: "メインテーマ: \n見出し1: \n見出し2: \n見出し3: ",
  },
];

export function getTemplateText(id: TemplateId): string {
  return TEMPLATES.find((t) => t.id === id)?.text ?? TEMPLATES[0].text;
}
