/**
 * 手書き→テキスト変換の実現可否を判断するための、ローカル完結（外部API通信なし）の
 * 精度検証スパイク。本番のメモ機能（memoStore/types）には一切触れていない。
 * KanjiCanvas（stroke座標ベースのオンデバイス日本語認識、MIT）を
 * `/vendor/kanjicanvas/` としてバンドルし、1文字ずつ書いて top1/top3 命中率を集計する。
 */

declare const KanjiCanvas: {
  init(id: string): void;
  erase(id: string): void;
  deleteLast(id: string): void;
  recognize(id: string): string;
  ["recordedPattern_draw-canvas"]?: unknown[];
};

type Category = "hiragana" | "katakana" | "kanji";

interface TestItem {
  char: string;
  category: Category;
}

const CATEGORY_LABEL: Record<Category, string> = {
  hiragana: "ひらがな",
  katakana: "カタカナ",
  kanji: "漢字",
};

const HIRAGANA =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
const KATAKANA =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
// KanjiCanvas の ref-patterns に収録が確認できている常用漢字のみ選定
const KANJI = "一二三七九十人今他代以京事予中主世下上久不";

/** 1カテゴリあたりの出題数。母集合はもっと大きいが、さっと精度感を見るための出題数はこれで絞る。 */
const SAMPLE_SIZE_PER_CATEGORY = 8;

function shuffled<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildTestSet(): TestItem[] {
  const pools: [string, Category][] = [
    [HIRAGANA, "hiragana"],
    [KATAKANA, "katakana"],
    [KANJI, "kanji"],
  ];
  const items: TestItem[] = [];
  for (const [pool, category] of pools) {
    const chars = shuffled(pool.split("")).slice(0, SAMPLE_SIZE_PER_CATEGORY);
    for (const char of chars) items.push({ char, category });
  }
  // 出題順をシャッフル（カテゴリごとに固まって出るのを避ける）
  return shuffled(items);
}

interface ResultRow {
  char: string;
  category: Category;
  candidates: string[];
  rank: number | null; // 1-indexed。候補内に無ければ null
}

const CANVAS_ID = "draw-canvas";
const testSet = buildTestSet();
const results: ResultRow[] = [];
let currentIndex = 0;

const progressEl = document.getElementById("progress")!;
const targetCharEl = document.getElementById("target-char")!;
const targetCategoryEl = document.getElementById("target-category")!;
const resultEl = document.getElementById("result")!;
const nextRowEl = document.getElementById("next-row")!;
const summaryEl = document.getElementById("summary")!;
const btnRecognize = document.getElementById("btn-recognize") as HTMLButtonElement;

KanjiCanvas.init(CANVAS_ID);

function currentItem(): TestItem {
  return testSet[currentIndex];
}

function renderTarget(): void {
  const item = currentItem();
  targetCategoryEl.textContent = CATEGORY_LABEL[item.category];
  targetCharEl.textContent = item.char;
  progressEl.textContent = `${currentIndex + 1} / ${testSet.length}`;
  resultEl.innerHTML = "";
  nextRowEl.style.display = "none";
  btnRecognize.disabled = false;
}

function recordedStrokeCount(): number {
  const pattern = (KanjiCanvas as unknown as Record<string, unknown[]>)[`recordedPattern_${CANVAS_ID}`];
  return Array.isArray(pattern) ? pattern.length : 0;
}

function onRecognize(): void {
  if (recordedStrokeCount() === 0) {
    resultEl.innerHTML = `<span class="miss">まだ何も書いていません</span>`;
    return;
  }
  const raw = KanjiCanvas.recognize(CANVAS_ID);
  const candidates = raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const item = currentItem();
  const rankIndex = candidates.indexOf(item.char);
  const rank = rankIndex === -1 ? null : rankIndex + 1;

  results.push({ char: item.char, category: item.category, candidates, rank });

  const hitTop1 = rank === 1;
  const hitTop3 = rank !== null && rank <= 3;
  const statusHtml = hitTop3
    ? `<span class="hit">${hitTop1 ? "top1で命中" : `top${rank}で命中`}</span>`
    : `<span class="miss">候補内に無し</span>`;

  resultEl.innerHTML = `
    <div class="candidates">${candidates.slice(0, 10).join(" ")}</div>
    <div>正解: ${item.char} — ${statusHtml}</div>
  `;
  nextRowEl.style.display = "flex";
  btnRecognize.disabled = true;
}

function onNext(): void {
  currentIndex++;
  KanjiCanvas.erase(CANVAS_ID);
  if (currentIndex >= testSet.length) {
    renderSummary();
    return;
  }
  renderTarget();
}

function renderSummary(): void {
  progressEl.textContent = "完了";
  targetCategoryEl.textContent = "";
  targetCharEl.textContent = "";
  document.getElementById(CANVAS_ID)!.style.display = "none";
  document.querySelector(".row")!.setAttribute("style", "display:none");
  nextRowEl.style.display = "none";
  resultEl.innerHTML = "";

  const categories: Category[] = ["hiragana", "katakana", "kanji"];
  let rowsHtml = "";
  for (const cat of categories) {
    const rows = results.filter((r) => r.category === cat);
    if (rows.length === 0) continue;
    const top1 = rows.filter((r) => r.rank === 1).length;
    const top3 = rows.filter((r) => r.rank !== null && r.rank <= 3).length;
    rowsHtml += `<tr><td>${CATEGORY_LABEL[cat]}</td><td>${rows.length}問</td><td>top1: ${top1}/${rows.length}</td><td>top3: ${top3}/${rows.length}</td></tr>`;
  }
  const totalTop1 = results.filter((r) => r.rank === 1).length;
  const totalTop3 = results.filter((r) => r.rank !== null && r.rank <= 3).length;
  rowsHtml += `<tr><td><b>全体</b></td><td>${results.length}問</td><td>top1: ${totalTop1}/${results.length}</td><td>top3: ${totalTop3}/${results.length}</td></tr>`;

  summaryEl.innerHTML = `
    <table>
      <tr><th>種別</th><th>問題数</th><th>top1命中</th><th>top3命中</th></tr>
      ${rowsHtml}
    </table>
    <p>下のJSONをそのままチームへ共有できます（誤答した文字と候補の内訳）。</p>
    <textarea readonly>${JSON.stringify(results, null, 2)}</textarea>
  `;
}

btnRecognize.addEventListener("click", onRecognize);
document.getElementById("btn-next")!.addEventListener("click", onNext);
document.getElementById("btn-clear")!.addEventListener("click", () => KanjiCanvas.erase(CANVAS_ID));
document.getElementById("btn-undo")!.addEventListener("click", () => KanjiCanvas.deleteLast(CANVAS_ID));

renderTarget();
