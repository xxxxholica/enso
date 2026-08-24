import { computeOpacity, MS_PER_DAY, remainingMs, STANDARD_LIFESPAN_DAYS } from "./fade";
import { circleIntersectsBox, clampToCircle, eraseFromStroke } from "./geometry";
import { loadMemos, saveMemos } from "./storage";
import { LINE_HEIGHT_MULTIPLIER } from "./textLayout";
import type { LifespanDays, Memo, MemoStyle, Point, Stroke, TextMemo } from "./types";

function makeId(): string {
  return `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * メモ全体の状態を保持し、既定ではlocalStorageと同期させるストア。
 * 保存・復元・経時フェードの判定・なぞり復活・全体リセットをまとめて担う。
 */
export class MemoStore {
  private memos: Memo[];
  private onChange?: (memos: readonly Memo[]) => void;
  private persistLocally: boolean;

  /**
   * onChangeは、アカウント同期（cloudSync.ts）がローカルの変更をクラウドに
   * 反映するためのフック。ログインしていない間は呼ばれても何もしない。
   * persistLocallyをfalseにすると、localStorage["memos"]を一切読み書きしない
   * （個人用ストアと衝突させたくない共有キャンバス用インスタンス、
   * sharedCanvasSync.ts参照——真の保存先はサーバー側のため、ここでは何も保存しない）。
   */
  constructor(onChange?: (memos: readonly Memo[]) => void, persistLocally: boolean = true) {
    this.persistLocally = persistLocally;
    this.memos = persistLocally ? loadMemos() : [];
    this.onChange = onChange;
  }

  private persist(): void {
    if (this.persistLocally) saveMemos(this.memos);
    this.onChange?.(this.memos);
  }

  /**
   * クラウド（またはルームのサーバー側の内容）で丸ごと置き換える（アカウントログイン時や
   * 共有キャンバスのポーリング同期用）。ローカルの変更点だけを賢く合成するような処理はせず、
   * 常にサーバー側を正として上書きする——複数端末/複数人での本格的な競合解決は今回のスコープ外。
   */
  replaceAll(memos: Memo[]): void {
    this.memos = memos;
    if (this.persistLocally) saveMemos(this.memos);
    // 取り込んだ直後にそのまま押し戻す(onChange経由の再送信)必要はないため、
    // ここではpersist()を経由せずonChangeを呼ばない。
  }

  getAll(): readonly Memo[] {
    return this.memos;
  }

  getActive(): Memo[] {
    return this.memos.filter((m) => m.status === "active");
  }

  /** 振り返りビュー用: 消滅済みメモを作成日時の昇順で返す。 */
  getFaded(): Memo[] {
    return this.memos
      .filter((m) => m.status === "faded")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 新しい手描きメモを1点で開始する（最初のストロークはこの直後に addPointToStroke で積む）。 */
  createMemo(start: Point, style: MemoStyle, now: number = Date.now()): Memo {
    const memo: Memo = {
      id: makeId(),
      kind: "stroke",
      x: start.x,
      y: start.y,
      strokes: [[start]],
      createdAt: now,
      lastTracedAt: now,
      traceHistory: [now],
      recoveredMs: 0,
      lifespanDays: style.lifespanDays,
      status: "active",
      tool: style.tool,
      color: style.color,
      lineWidth: style.lineWidth,
    };
    this.memos.push(memo);
    this.persist();
    return memo;
  }

  /**
   * 新しいテキストメモを作る。折り返し済みの行(textLines)とボックスサイズ(boxWidth/boxHeight)は
   * 呼び出し側（textLayout.ts の wrapTextAtReferenceScale / normalizedBoxSize）で計算済みのものを渡す
   * ——テキストの折り返しにはcanvasのフォント計測が必要で、ストアはcanvas contextを持たないため。
   */
  createTextMemo(
    anchor: Point,
    text: string,
    textLines: string[],
    fontSize: number,
    boxWidth: number,
    boxHeight: number,
    style: { color: string; lifespanDays: LifespanDays; align?: "center" | "left"; lineHeight?: number },
    now: number = Date.now()
  ): TextMemo {
    const memo: TextMemo = {
      id: makeId(),
      kind: "text",
      x: anchor.x,
      y: anchor.y,
      text,
      textLines,
      fontSize,
      boxWidth,
      boxHeight,
      createdAt: now,
      lastTracedAt: now,
      traceHistory: [now],
      recoveredMs: 0,
      lifespanDays: style.lifespanDays,
      status: "active",
      color: style.color,
      align: style.align ?? "center",
      lineHeight: style.lineHeight ?? LINE_HEIGHT_MULTIPLIER,
    };
    this.memos.push(memo);
    this.persist();
    return memo;
  }

  /** 既存メモに新しいストロークを1本追加する（ペンを持ち上げて再度書き始めたとき）。手描きメモにのみ有効。 */
  startStroke(memoId: string, start: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke") return;
    memo.strokes.push([start]);
    this.persist();
  }

  /** 直近のストロークに点を追加する。手描きメモにのみ有効。 */
  addPointToLastStroke(memoId: string, point: Point): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "stroke" || memo.strokes.length === 0) return;
    const stroke: Stroke = memo.strokes[memo.strokes.length - 1];
    stroke.push(point);
    this.persist();
  }

  /**
   * なぞって復活: 以前は不透明度を無条件で100%に戻し猶予期間の起点を
   * まるごとリセットしていたが、なぞればいつまでも際限なく復活できてしまう
   * のは適切かという議論から（Issue #11）、1回のなぞりで戻せる量を
   * 「寿命(lifespanDays)の15%ぶん」に制限し、かつメモが生涯に回復できる
   * 合計時間も「自分自身の寿命ぶん」を上限にした——寿命を使い切ったメモは
   * それ以上なぞっても何も起きず、自然に消えていくだけになる。
   * 1回のなぞりで戻す量は、寿命の15%・「残っている回復可能時間」・
   * 「今との差（経過時間）」の3つのうち一番小さいものになる。3つ目が
   * 必要なのは、既にほぼ100%近い状態でなぞった場合に、経過時間が0未満に
   * （＝まだ来ていない時刻を経過済み扱いに）ならないようにするためだが、
   * その頭打ち分をrecoveredMsに丸ごと計上してしまうと、実際には
   * lastTracedAtをほとんど動かせなかったのに生涯の回復可能時間だけ
   * 消費してしまう（実際に戻せた分だけを消費したことにする必要がある）。
   */
  reviveMemo(memoId: string, now: number = Date.now()): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    const lifespanMs = (memo.lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
    const budgetLeftMs = Math.max(0, lifespanMs - memo.recoveredMs);
    if (budgetLeftMs <= 0) return; // 生涯の回復可能時間を使い切った：これ以上は回復しない
    const wantMs = Math.min(lifespanMs * 0.15, budgetLeftMs);
    const grantMs = Math.min(wantMs, Math.max(0, now - memo.lastTracedAt));
    if (grantMs <= 0) return; // 既に「今」に追いついている（これ以上経過時間を削れない）
    memo.lastTracedAt += grantMs;
    memo.recoveredMs += grantMs;
    memo.traceHistory.push(memo.lastTracedAt);
    this.persist();
  }

  /** なぞって復活の残り体力（View用）。指定メモがまだ回復に使える時間(ms)と、
   *  現時点で消滅までにかかる残り時間(ms)、比率表示（バー）用の基準となる
   *  寿命そのもの(ms)を返す——「なぞる」「移動」道具でメモに触れている間・
   *  （PCでは）ホバーしている間の案内表示（canvasView.ts）に使う。
   *  存在しない/非活性なメモの場合はnull。 */
  reviveBudgetOf(
    memoId: string,
    now: number = Date.now()
  ): { remainingMs: number; extendableMs: number; lifespanMs: number } | null {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return null;
    const lifespanMs = (memo.lifespanDays ?? STANDARD_LIFESPAN_DAYS) * MS_PER_DAY;
    const extendableMs = Math.max(0, lifespanMs - memo.recoveredMs);
    return { remainingMs: remainingMs(now - memo.lastTracedAt, memo.lifespanDays), extendableMs, lifespanMs };
  }

  /**
   * 既存のテキストメモの内容を書き換える（テキストの編集機能）。フォントサイズ・色・
   * 消えるまでの期間は変更しない（内容を編集する操作であって、見た目の再設定ではないため）。
   * 手描きメモを触ったときと同様、編集も「触れた」ことになるので、なぞって復活と同じく
   * 不透明度を100%に戻し猶予期間の起点をリセットする。
   */
  updateTextMemo(
    memoId: string,
    text: string,
    textLines: string[],
    boxWidth: number,
    boxHeight: number,
    now: number = Date.now()
  ): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.kind !== "text" || memo.status !== "active") return;
    memo.text = text;
    memo.textLines = textLines;
    memo.boxWidth = boxWidth;
    memo.boxHeight = boxHeight;
    memo.lastTracedAt = now;
    memo.traceHistory.push(now);
    this.persist();
  }

  /** メモを1件削除する（テキスト編集で全文を消して確定した場合など）。 */
  deleteMemo(memoId: string): void {
    const before = this.memos.length;
    this.memos = this.memos.filter((m) => m.id !== memoId);
    if (this.memos.length !== before) this.persist();
  }

  /**
   * メモ全体（手描き・テキストどちらも）を (dx, dy) だけ平行移動する
   * （移動道具でドラッグしている間、ポインタが動くたびに呼ばれる差分移動）。
   * 描画可能領域の外にはみ出さないよう、移動後の各点はclampで丸め込む
   * ——ストロークは点ごとにクランプするため、境界に触れた部分は形がわずかに
   * 丸められる（描画時のクランプと同じ挙動）。既定は半径1の円だが、SMUIの
   * ように選んだフレーム形状（楕円/長方形）の輪郭でクランプしたい呼び出し元は
   * frameShape.tsの対応するclampを渡す——このストア自体は「今どの形状を
   * 見ているか」を知らない（同じ個人MemoStoreが、常に円の「キャンバス」タブと
   * 形状を選べるSMUIの左レンズの両方から使われるため、ストアの状態としては
   * 持てない）。
   * 移動は「消えるまでの期間」や「なぞって復活」とは無関係な、位置だけの
   * 操作として扱う。よって lastTracedAt / traceHistory には触れない
   * ——ただ場所を直しただけで内容に触れたわけではない、という判断。
   */
  translateMemo(
    memoId: string,
    dx: number,
    dy: number,
    clamp: (p: Point) => Point = (p) => clampToCircle(p, 1)
  ): void {
    const memo = this.memos.find((m) => m.id === memoId);
    if (!memo || memo.status !== "active") return;
    if (dx === 0 && dy === 0) return;

    if (memo.kind === "stroke") {
      memo.strokes = memo.strokes.map((stroke) => stroke.map((p) => clamp({ x: p.x + dx, y: p.y + dy })));
      const first = memo.strokes[0]?.[0];
      if (first) {
        memo.x = first.x;
        memo.y = first.y;
      }
    } else {
      const moved = clamp({ x: memo.x + dx, y: memo.y + dy });
      memo.x = moved.x;
      memo.y = moved.y;
    }
    this.persist();
  }

  /**
   * 全アクティブメモの不透明度を再計算し、猶予切れのものを faded に変更する。
   * 呼び出すたびに persist するのはコストが高いので、状態が変化した時だけ保存する。
   */
  tick(now: number = Date.now()): boolean {
    let changed = false;
    for (const memo of this.memos) {
      if (memo.status !== "active") continue;
      const elapsed = now - memo.lastTracedAt;
      const opacity = computeOpacity(elapsed, memo.lifespanDays);
      if (opacity === 0) {
        memo.status = "faded";
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  /** 現在時刻を基準にした、アクティブメモの不透明度スナップショット。描画専用。 */
  opacityOf(memo: Memo, now: number = Date.now()): number {
    return computeOpacity(now - memo.lastTracedAt, memo.lifespanDays);
  }

  resetAll(): void {
    this.memos = [];
    this.persist();
  }

  /**
   * 消しゴム: center から radius 以内をアクティブなメモから削除する（本当の手動削除）。
   * 手描きメモはストロークが分断される場合は複数本に分け、全て消えたメモは配列から取り除く。
   * テキストメモは部分削除ができないため、当たり判定用のボックス(boxWidth/boxHeight)に
   * 触れたらメモごと削除する。消滅済み（振り返りビューにある）メモには影響しない。
   */
  eraseAt(center: Point, radius: number): boolean {
    let changed = false;
    this.memos = this.memos.filter((memo) => {
      if (memo.status !== "active") return true;

      if (memo.kind === "text") {
        const touched = circleIntersectsBox(center, radius, {
          x: memo.x,
          y: memo.y,
          width: memo.boxWidth,
          height: memo.boxHeight,
        });
        if (touched) changed = true;
        return !touched;
      }

      const newStrokes = memo.strokes.flatMap((s) => eraseFromStroke(s, center, radius));
      const strokeCountChanged =
        newStrokes.length !== memo.strokes.length ||
        newStrokes.some((s, i) => s.length !== memo.strokes[i]?.length);
      if (strokeCountChanged) changed = true;
      memo.strokes = newStrokes;
      return newStrokes.length > 0;
    });
    if (changed) this.persist();
    return changed;
  }
}
