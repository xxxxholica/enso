import { CircularCanvas } from "./canvasView";
import type { ToolState } from "./canvasView";
import { createFadeVisibility } from "./fadeVisibility";
import { FIXED_LIFESPAN_DAYS } from "./fade";
import { MemoStore } from "./memoStore";
import { RewindSelector } from "./rewindSelector";
import { FONT_SIZE_STEPS, measureTextBoxWidthPx, normalizedBoxSize, wrapTextAtReferenceScale } from "./textLayout";
import { PEN_WIDTH_RANGE } from "./toolStyle";
import type { Memo, Point } from "./types";

const INK = "oklch(22% 0.012 55)";
const HOUR = 60 * 60 * 1000;

/** 仮想時計の進み方（実時間1msに対して盤面上の時間が何ms進むか）。本物の
 *  寿命（1日、FIXED_LIFESPAN_DAYS）を数十秒〜数分で体験できるよう加速する。
 *  以前は400だったが、「振り返り」の目盛りに対してどれだけ経過したかが
 *  ユーザーが手順を終えるまでにかかった実時間（人によって大きくばらつく）
 *  に敏感すぎ、振り返っても対象が見つからない／既に完全に消えてしまっている
 *  ことがあった（ユーザー報告）。振り返りの見本自体はmountRewind()で手順に
 *  入った瞬間を基準に作り直し（reseedForRewindDemo）、以後の「たった今」も
 *  その瞬間の値（rewindNowRef）に固定してしまう——探索にどれだけ実時間を
 *  かけようと結果が変わらないため、この値はもう振り返りの見えやすさには
 *  一切影響しない。「見ている間にも自然に薄れていく」という一手順目の
 *  体感速度だけの調整値として、控えめな値に下げてある。 */
const VIRTUAL_ACCEL = 60;

/** .usage-guideモーダル自身のz-index(41、style.css)より前面に出すための値。
 *  「書く」手順のtext-editor-overlay専用（CircularCanvasOptions.textEditorZIndex
 *  参照）。 */
const TEXT_EDITOR_Z_INDEX = 45;

type StepId = "write" | "watch" | "keep" | "release" | "rewind" | "done";
const STEP_ORDER: StepId[] = ["write", "watch", "keep", "release", "rewind", "done"];

const MESSAGES: Record<StepId, string> = {
  write: "円の中をタップして、思いついたことを書いてみましょう。",
  watch: "ほかにも、いくつか思いつきが置いてあります。何もしなければ、自然に薄れて消えていきます。少し眺めてみましょう。",
  keep: "残したい一枚に触れたまま、指で円を描くように反時計回りに回してみてください。時間が巻き戻り、また留まります。",
  release: "今度は、要らない一枚に触れたまま、時計回りに回して早く手放してみましょう。",
  rewind: "下のスライダーを動かして、少し前の盤面を振り返ってみましょう。",
  done: "全部は残せません。だからこそ、そうやって選び続けた一枚には意味があります。",
};

/** 掴んで回す対象の追跡用。lastTracedAtは移動道具の振り回し操作
 *  （nudgeMemoClock、canvasView.ts）でしか変化しないため、seed時の値からの
 *  増減を見るだけで「反時計回りに回した／時計回りに回した」を正確に検出できる
 *  ——受動的な経時フェード（tick）はlastTracedAtを一切書き換えないので、
 *  放置による自然消滅と誤検知することもない。「残したい一枚」がどれかは
 *  指示文で特定していない（3枚とも見た目上は対等）ため、判定は3枚のうち
 *  どれか1枚ぶんでも条件を満たせば成立させる——特定の1枚だけを見ていると、
 *  ユーザーが別の1枚を回した時に「実際に巻き戻っているのに手順が進まない」
 *  ことになる（ユーザー報告）。 */
interface TrackedMemo {
  id: string;
  initialLastTracedAt: number;
}

/**
 * 使い方ページ（usageGuide.ts）の中間パートで使う、体験専用のサンドボックス。
 * 本物のCircularCanvas/MemoStoreとは完全に別の使い捨てインスタンスを持ち、
 * 自前のrequestAnimationFrameで駆動する——本物のインスタンスは外から
 * render()を呼び続けないと何も描かれないため（過去のインタラクティブ
 * チュートリアルが撤廃された理由の1つ）。
 *
 * ポインタ操作（pointerdown/move/leave）はこのインスタンス自身のcanvas要素に
 * 閉じたリスナーのため、使い方ページの全画面オーバーレイが背後の本物の
 * キャンバスを覆っている間は本物には一切届かない。window単位の
 * pointerup/pointercancelは意図的に横取りしていない：本物のonPointerUpは
 * 自身の状態がidleの間は何もしない（=このサンドボックスを操作している間、
 * 本物は必ずidleのまま）ため無害であり、かつこのサンドボックス自身の
 * ジェスチャー終了処理もwindow単位のpointerupに依存しているため、
 * window全体でstopPropagationするとこちらの操作まで巻き込んで壊れてしまう。
 *
 * 「書く」手順だけは本物のテキスト入力（道具を"text"にしてタップ→
 * canvasView.tsのopenTextEditor）を使う。それ以外の手順ではキー入力を
 * 一切必要としないため、使い方ページ側（usageGuide.ts）がwindow単位の
 * keydownをcapture段でstopPropagationして本物のonGlobalKeyDown
 * （ブラインドタイピング）に渡さないようにしているが、「書く」手順で
 * このサンドボックス自身のtext-editor-overlay（.text-editor-overlay）に
 * フォーカスがある間だけは例外的に素通しする——それでも本物へブラインド
 * タイピングが漏れないのは、本物のonGlobalKeyDownがdocument.activeElementが
 * テキストエリアの間は横取りしないという既存のガード（他の入力欄にフォーカスが
 * ある間は横取りしないためのもの）にそのまま守られるため。詳しくは
 * usageGuide.tsのonKeyDown参照。
 */
export class TutorialSandbox {
  private canvasWrap: HTMLElement;
  private messageEl: HTMLElement;
  private rewindWrap: HTMLElement;
  private setRewindVisible: (show: boolean) => void;
  private nextBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;
  private doneNextBtn: HTMLButtonElement;
  /** 全手順を終えた（スキップ含む）瞬間に一度だけ呼ばれる。使い方ページ
   *  （usageGuide.ts）がページ送りで次の「結」画面へ進めるためのフック。 */
  private onComplete: (() => void) | null;

  private store: MemoStore | null = null;
  private canvasView: CircularCanvas | null = null;
  private rewindSelector: RewindSelector | null = null;

  private raf = 0;
  private running = false;
  private realStartMs = 0;
  private virtualBaseMs = 0;

  private step: StepId = "write";
  /** seed()で置いた添え物＋「書く」手順でユーザー自身が書いたものの初期
   *  lastTracedAt。checkProgressはこの中のどれか1枚でも増減していれば
   *  keep/releaseを達成扱いにする。 */
  private memoBaselines: TrackedMemo[] = [];
  /** 「書く」手順の完了検出用：seed()で置いた添え物のidをあらかじめ入れておき、
   *  store.getAll()にこれ以外のidが現れたら「ユーザーが新しく書いた」と判定する
   *  （内容は問わない）。 */
  private knownMemoIds = new Set<string>();
  /** 振り返り手順で作り直す対象のid一覧（seed()の添え物＋「書く」手順で
   *  ユーザーが書いたものを作成順に追加）。reseedForRewindDemo参照。 */
  private reseedableIds: string[] = [];
  /** 「振り返り」手順に入った瞬間の仮想時刻を固定した基準点。以降このスライダーの
   *  「N時間前」は、その都度のcurrentVirtualNow()ではなく常にこの値から引く
   *  ——探索にどれだけ実時間をかけても（数秒でも数分でも）見え方が変わらない
   *  ようにするため（ユーザー報告：巻き戻しても反応しないことがあった）。
   *  「たった今」（ms<=0）だけは例外でrewindAt=nullとなり、CircularCanvas側が
   *  常に本物のライブな現在時刻を使う——探索中ずっと同じ「今」に固定されて
   *  見えてしまうことはない。 */
  private rewindNowRef: number | null = null;

  constructor(container: HTMLElement, onComplete?: () => void) {
    this.onComplete = onComplete ?? null;
    container.className = "tutorial-sandbox";

    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "tutorial-sandbox-canvas-wrap";

    this.messageEl = document.createElement("p");
    this.messageEl.className = "tutorial-sandbox-message";

    this.rewindWrap = document.createElement("div");
    this.rewindWrap.className = "tutorial-sandbox-seek fade-visible";
    this.rewindWrap.hidden = true;
    this.setRewindVisible = createFadeVisibility(this.rewindWrap);

    const actions = document.createElement("div");
    actions.className = "tutorial-sandbox-actions";
    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.className = "pill-btn";
    this.nextBtn.textContent = "つぎへ";
    this.nextBtn.addEventListener("click", () => this.advanceTo("keep"));
    this.skipBtn = document.createElement("button");
    this.skipBtn.type = "button";
    this.skipBtn.className = "text-link tutorial-sandbox-skip";
    this.skipBtn.textContent = "この体験をスキップ";
    this.skipBtn.addEventListener("click", () => this.advanceTo("done"));
    this.doneNextBtn = document.createElement("button");
    this.doneNextBtn.type = "button";
    this.doneNextBtn.className = "pill-btn";
    this.doneNextBtn.textContent = "つぎへ";
    this.doneNextBtn.hidden = true;
    this.doneNextBtn.addEventListener("click", () => this.onComplete?.());
    actions.append(this.nextBtn, this.skipBtn, this.doneNextBtn);

    container.append(this.canvasWrap, this.messageEl, this.rewindWrap, actions);
  }

  /** 使い方ページを開いている間だけ呼ぶ。開き直すたびにまっさらな状態から
   *  やり直せるよう、新しいストア・キャンバスを作り直す。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = "write";
    this.syncStep();

    this.store = new MemoStore(undefined, false);
    this.canvasView = new CircularCanvas(this.canvasWrap, this.store, () => this.toolStateFor(), {
      // 本物のキャンバスと同じ「1回転まるごと・掴んだ点から半径24px以上」を
      // そのまま求めると、この操作を初めて知る人には難しすぎて手順で止まって
      // しまうことがあった（ユーザー報告）。この練習用サンドボックスに限り、
      // 半周・半径16pxまで緩める——道具バーを持たない小さな円の中で「回すと
      // 時間が動く」という感覚を最初に掴んでもらうのが目的であり、本物と
      // 完全に同じ厳しさを課す必要はない。
      rotateStepRad: Math.PI,
      rotateMinRadiusPx: 16,
      // 「書く」手順で開くtext-editor-overlayは、既定z-index(20)のままだと
      // 使い方ページのモーダル自身（z-index 41）の背後に隠れてしまう
      // ——全画面モーダルは本来「本物のキャンバスの書きかけテキストを隠す」
      // 前提でtext-editor-overlayより手前に設計されているが、ここではその
      // モーダルの中で本物のテキスト入力を体験させたいので、逆に前面に出す。
      textEditorZIndex: TEXT_EDITOR_Z_INDEX,
    });
    this.realStartMs = Date.now();
    this.virtualBaseMs = Date.now();
    this.seed();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 使い方ページを閉じたら呼ぶ。CircularCanvasのwindow単位リスナー等を
   *  destroy()できちんと解除し、rAFも止める——開いたままrAFを回し続けると
   *  無駄に電力を使う（usageGuide.tsの挿絵アニメーションと同じ理由）。 */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvasView?.destroy();
    this.canvasView = null;
    this.store = null;
    this.memoBaselines = [];
    this.knownMemoIds = new Set();
    this.reseedableIds = [];
    this.rewindNowRef = null;
    this.rewindSelector = null;
    this.rewindWrap.replaceChildren();
    this.rewindWrap.hidden = true;
    this.rewindWrap.classList.remove("is-visible");
  }

  /** 「書く」手順だけテキスト道具、それ以外は選択（移動）道具——このサンドボックスで
   *  体験させたい操作を、書く・掴んで回す・振り返りスライダーの3つに絞る
   *  （道具バー自体は持たない。ユーザー指示）。 */
  private toolStateFor(): ToolState {
    return {
      tool: this.step === "write" ? "text" : "move",
      color: INK,
      lifespanDays: FIXED_LIFESPAN_DAYS,
      fontSize: FONT_SIZE_STEPS.medium,
      lineWidth: PEN_WIDTH_RANGE.default,
      eraserRadius: 16,
    };
  }

  /** 「書く」手順の前に、添え物を2枚だけ仕込んでおく——ユーザー自身が
   *  これから書く1枚と合わせて、後の手順（残す・消す・振り返る）で
   *  触る対象が最低3枚になるようにする。手を出さなくても物語が進むよう、
   *  どの手順にも紐付けない添え物として置く。 */
  private seed(): void {
    if (!this.store) return;
    const now0 = this.virtualBaseMs;
    // テキスト測定専用の使い捨てcanvas（DOMには挿入しない）。手描きストローク
    // だと、掴んで動かした先が円の縁にかかった時に点ごとクランプされて線が
    // 潰れて見えてしまう（ユーザー指摘）ため、位置だけがまとめてクランプされる
    // テキストメモに変えた。
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    // 「薄れる」手順ですぐ見比べられるよう、既に薄れかけた状態で置く
    // （自分がこれから書く1枚は真新しいまま、という対比になる）。
    const ambient = seedTextThought(measureCtx, this.store, { x: 0, y: 0.45 }, "夢の続き", 11 * HOUR, now0);
    // 掴んで振り回すと、その分だけメモ自体もポインタに追従して動く
    // （canvasView.tsのupdateRotationGesture参照）。縁ぎりぎりに置くと、
    // 少し振り回しただけで縁の外にはみ出して欠けて見えてしまうため、
    // 中心寄りに置いて振り回す余地を持たせる——また、この2枚は右寄り・
    // 下寄りに置き、「書く」手順で円の左〜中央あたりにタップして書き
    // やすい余地を残す。
    const decoy = seedTextThought(measureCtx, this.store, { x: 0.32, y: -0.22 }, "買い物リスト", 5 * HOUR, now0);
    this.knownMemoIds = new Set([ambient.id, decoy.id]);
    this.reseedableIds = [ambient.id, decoy.id];
    // 「残したい一枚」がどれかは指示文で特定していないため、この2枚
    // （＋「書く」手順でユーザーが書いたもの）すべてを判定対象にする
    // （checkProgress参照）。
    this.memoBaselines = [ambient, decoy].map(trackedMemoOf);
  }

  private currentVirtualNow(): number {
    return this.virtualBaseMs + (Date.now() - this.realStartMs) * VIRTUAL_ACCEL;
  }

  private loop = (): void => {
    if (!this.running || !this.store || !this.canvasView) return;
    const now = this.currentVirtualNow();
    this.store.tick(now);
    this.canvasView.render(now);
    this.checkProgress();
    this.raf = requestAnimationFrame(this.loop);
  };

  private checkProgress(): void {
    if (!this.store) return;
    const memos: readonly Memo[] = this.store.getAll();
    if (this.step === "write") {
      // 内容は問わず、seed()で置いた添え物に無い新しいidが現れたら
      // 「ユーザーが書き終えた」と判定する（canvasView.tsのopenTextEditorが
      // blur時にstore.createTextMemoを呼ぶタイミングを直接コールバックで
      // 拾う手段が無いため、ストアをポーリングして検出する）。
      const newMemo = memos.find((m) => !this.knownMemoIds.has(m.id));
      if (newMemo) {
        this.knownMemoIds.add(newMemo.id);
        this.memoBaselines.push(trackedMemoOf(newMemo));
        this.reseedableIds.push(newMemo.id);
        this.advanceTo("watch");
      }
    } else if (this.step === "keep") {
      if (this.anyMemoMoved(memos, "up")) this.advanceTo("release");
    } else if (this.step === "release") {
      if (this.anyMemoMoved(memos, "down")) this.advanceTo("rewind");
    } else if (this.step === "rewind" && (this.rewindSelector?.getRewindMs() ?? 0) > 0) {
      // inputイベントの発火に頼らず、毎フレーム直接いまのスライダー値を見る。
      // 以前はonChange（inputイベント）が発火した時だけ達成フラグを立てていたが、
      // 実際に遡って見えているのに次に進まないという報告があった——イベントの
      // 取りこぼしが万一あっても、この方式なら次のフレーム（1/60秒後）には
      // 必ず現在値を拾えるため、取りこぼしようがない。
      this.advanceTo("done");
    }
  }

  /** memoBaselinesのうちどれか1枚でも、初期値からup(増加=反時計回り)/
   *  down(減少=時計回り)の向きに動いていればtrue。 */
  private anyMemoMoved(memos: readonly Memo[], direction: "up" | "down"): boolean {
    return this.memoBaselines.some((baseline) => {
      const memo = memos.find((m) => m.id === baseline.id);
      if (!memo) return false;
      return direction === "up"
        ? memo.lastTracedAt > baseline.initialLastTracedAt
        : memo.lastTracedAt < baseline.initialLastTracedAt;
    });
  }

  /** 手順を先に進める（後戻りはしない）。 */
  private advanceTo(step: StepId): void {
    if (STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(this.step)) return;
    this.step = step;
    if (step === "rewind") this.mountRewind();
    this.syncStep();
  }

  private syncStep(): void {
    this.messageEl.textContent = MESSAGES[this.step];
    this.nextBtn.hidden = this.step !== "watch";
    this.skipBtn.hidden = this.step === "done";
    this.doneNextBtn.hidden = this.step !== "done";
  }

  /** 振り返りスライダーは「遡る」手順に入って初めて出す（一度に全部の道具を
   *  見せず、順番に体験させるため）。本物のRewindSelectorをそのまま使うが、
   *  値の受け渡し（getRewindAt）はDate.now()基準のため、加速した仮想時計を
   *  使うここでは生のms（getRewindMs）を自分で仮想「今」から引いて渡す。
   *  「今」はこの瞬間にrewindNowRefへ固定し、以後ずっとそれを使い続ける
   *  ——毎回this.currentVirtualNow()を呼び直すと、探索にかけた実時間ぶん
   *  「たった今」自体が動いてしまい、見本と目盛りの対応がその場でズレていく
   *  （ユーザー報告：巻き戻しても反応しないことがあった）。 */
  private mountRewind(): void {
    if (this.rewindSelector) return;
    this.rewindNowRef = this.currentVirtualNow();
    this.reseedForRewindDemo(this.rewindNowRef);
    this.rewindWrap.hidden = false;
    this.rewindSelector = new RewindSelector(this.rewindWrap, () => {
      if (!this.rewindSelector || !this.canvasView || this.rewindNowRef === null) return;
      const ms = this.rewindSelector.getRewindMs();
      this.canvasView.setRewindAt(ms <= 0 ? null : this.rewindNowRef - ms);
    });
    this.setRewindVisible(true);
  }

  /**
   * 「振り返り」手順に入る瞬間の仮想時刻（now、rewindNowRef）を基準に、
   * 3枚を作り直す。seed()時点の固定バックデートのままだと、ここに辿り着くまでに
   * 実際にかかった時間（読むのが速い人・遅い人で数十倍違う）ぶん仮想時計が
   * 進んでしまい、対象が振り返りスライダーの目盛り（15分〜3日前）の手前で
   * 既に作成前だったり、逆にとっくに完全消滅した後だったりして、「巻き戻しても
   * 反応しない」ことがあった（ユーザー報告）。この手順に入った瞬間を新しい
   * 基準点にして作り直せば、それまでに何分かかったかに関係なく、常に同じ
   * 目盛り幅で反応が見つかる。掴んで移動した後の位置はそのまま引き継ぐ
   * （作り直した瞬間に元の位置へ飛んで見えないように）。ドラッグ中の状態は
   * rewindAt!==nullで無効化されるため、作り直しのタイミング自体が操作と
   * 衝突することはない。
   */
  private reseedForRewindDemo(now: number): void {
    if (!this.store) return;
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    // バックデートは、不透明度が段階的に変わる境目（fade.tsのcomputeOpacity:
    // 3.43h/10.29hで100%→60%→20%と切り替わる）が「たった今」からすぐの
    // 目盛り1〜2個ぶん（15分〜30分前）以内に来るよう選んでいる。以前は
    // 1/3/6時間や4/5/9時間ずらしていたが、それだと最初の数目盛りの間は
    // 3枚とも同じ濃さのまま変わらず、大きくドラッグしないと違いに気づけ
    // なかった（ユーザー報告：1枚しか反応していないように見える）。この
    // 値なら、スライダーをほんの少し動かしただけで、置いた順（添え物2枚→
    // 「書く」手順で書いたもの）に違うタイミングで濃くなる／消えるのが分かる。
    // 「書く」で書いた内容はexisting.textをそのまま引き継ぐ——ユーザーが
    // 実際に書いた文面を、勝手に別の文言で上書きしてはいけない。
    const backdateHours = [3.5, 3.75, 10.35];
    this.reseedableIds = this.reseedableIds.map((id, i) => {
      const existing = this.store!.getAll().find((m) => m.id === id);
      if (!existing || existing.kind !== "text") return id;
      this.store!.deleteMemo(id);
      const anchor: Point = { x: existing.x, y: existing.y };
      const backdateMs = (backdateHours[i] ?? backdateHours[backdateHours.length - 1]) * HOUR;
      return seedTextThought(measureCtx, this.store!, anchor, existing.text, backdateMs, now).id;
    });
  }
}

/** 短い「思いつき」のテキストメモを、指定した仮想時刻に作られたことにして
 *  仕込む。backdateMsぶん過去に作ったことにすることで、開いた瞬間から
 *  薄れかけの盤面を見せられる。 */
function seedTextThought(
  measureCtx: CanvasRenderingContext2D,
  store: MemoStore,
  center: Point,
  text: string,
  backdateMs: number,
  now0: number
): Memo {
  const fontSize = FONT_SIZE_STEPS.medium;
  const boxWidthPx = measureTextBoxWidthPx(measureCtx, text, fontSize);
  const textLines = wrapTextAtReferenceScale(measureCtx, text, fontSize, boxWidthPx);
  const { width, height } = normalizedBoxSize(fontSize, textLines.length, boxWidthPx);
  return store.createTextMemo(
    center,
    text,
    textLines,
    fontSize,
    width,
    height,
    { color: INK, lifespanDays: FIXED_LIFESPAN_DAYS },
    now0 - backdateMs
  );
}

function trackedMemoOf(memo: Memo): TrackedMemo {
  return { id: memo.id, initialLastTracedAt: memo.lastTracedAt };
}
