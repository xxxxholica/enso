export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

/** null = 標準（固定7日カーブ）, number = 指定した猶予日数 (1 / 3 / 7) */
export type LifespanDays = number | null;

export type MemoStatus = "active" | "faded";

/** 描画ツール（見た目・太さ・質感）。消えるまでの期間とは独立した軸。 */
export type DrawTool = "pencil" | "pen" | "marker";

export type MemoKind = "stroke" | "text";

interface MemoBase {
  id: string;
  /** メモの代表座標（手書き=最初のストロークの始点、テキスト=テキストブロックの中心）。
   *  円の中心を原点とする、円の半径を1とした正規化座標系。 */
  x: number;
  y: number;
  createdAt: number;
  lastTracedAt: number;
  /**
   * なぞり直した時刻の履歴（昇順、先頭は必ずcreatedAtと同じ値）。
   * 振り返りのタイムラインスライダーで、過去の任意時刻における不透明度を
   * 再現するために使う。lastTracedAtはこの配列の末尾と常に一致する。
   */
  traceHistory: number[];
  lifespanDays: LifespanDays;
  status: MemoStatus;
  /** CSS色文字列（既定は本体のインク色と同じoklch文字列、ユーザーが選べば任意の色になる） */
  color: string;
}

/** 手描きの手書きメモ（ドラッグでのストローク）。 */
export interface StrokeMemo extends MemoBase {
  kind: "stroke";
  strokes: Stroke[];
  tool: DrawTool;
}

/** テキスト入力のメモ。 */
export interface TextMemo extends MemoBase {
  kind: "text";
  /** ユーザーが入力した元のテキスト（改行を含む）。 */
  text: string;
  /** 折り返し済みの行。作成時に一度だけ計算し、以後はこれをそのまま描画に使う
   *  （基準円=半径340pxでの折り返し結果なので、実際の半径に関わらず行分割は変わらない）。 */
  textLines: string[];
  /** 基準円（半径340px）におけるフォントサイズ(px)。実際の描画時は現在の半径に比例させ、
   *  読みやすさのための下限(MIN_FONT_PX)を必ず適用する。 */
  fontSize: number;
  /** 折り返し幅。円の半径を1とする正規化単位。 */
  boxWidth: number;
  /** 行数から決まるテキストブロックの高さ。円の半径を1とする正規化単位。
   *  なぞって復活・消しゴムの当たり判定に使う。 */
  boxHeight: number;
  /** 行の横方向の揃え方。省略時（既存データ含む）は"center"として扱う。
   *  持ち物チェックのテンプレートのように項目を縦に並べる文面は、行ごとに
   *  幅が違っても左端が揃って読みやすい"left"にする。 */
  align?: "center" | "left";
}

export type Memo = StrokeMemo | TextMemo;

/** 新しい手描きメモを作るときの見た目・消えるまでの期間の指定。 */
export interface MemoStyle {
  tool: DrawTool;
  color: string;
  lifespanDays: LifespanDays;
}
