/**
 * 「連続した手描きストロークを文字単位に分割できるか」の検証スパイク。
 * 前段の handwritingTest.ts（1文字ずつの認識精度検証）とは独立。
 * 分割は、ストロークを書かれた順に見ていき、直前までのグループの水平方向の
 * バウンディングボックスとの間隔がしきい値以内なら同じ文字とみなす、という単純な
 * ヒューリスティックのみで行う（時刻情報は使わない＝現行のStroke型に無いため）。
 * 分割後の各グループはKanjiCanvasにそのまま渡して認識する。
 */

declare const KanjiCanvas: {
  init(id: string): void;
  recognize(id: string): string;
};

interface Point {
  x: number;
  y: number;
}
type Stroke = Point[];

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Group {
  strokes: Stroke[];
  bbox: BBox;
}

const PHRASES = ["会議", "資料", "メモ", "たのむ", "あとで", "明日まで", "ありがとう", "打ち合わせ"];

const GROUP_COLORS = ["#c1440e", "#1a7a3a", "#1c5fa8", "#8a3fa0", "#b48a00", "#c1440e", "#1a7a3a", "#1c5fa8"];

interface ResultRow {
  phrase: string;
  thresholdPx: number;
  groupCount: number;
  guess: string;
  segmentationOk: boolean | null;
  recognitionOk: boolean | null;
}

const WORK_CANVAS_ID = "kc-work";
let phraseIndex = 0;
const results: ResultRow[] = [];

let strokes: Stroke[] = [];
let currentStroke: Stroke | null = null;
let lastAnalysis: { groups: Group[]; guess: string } | null = null;

const drawCanvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const drawCtx = drawCanvas.getContext("2d")!;
const overlayCtx = overlayCanvas.getContext("2d")!;
const thresholdInput = document.getElementById("threshold") as HTMLInputElement;
const thresholdValueEl = document.getElementById("threshold-value")!;
const progressEl = document.getElementById("progress")!;
const phraseEl = document.getElementById("phrase")!;
const guessEl = document.getElementById("guess")!;
const judgeRowEl = document.getElementById("judge-row") as HTMLElement;
const nextRowEl = document.getElementById("next-row") as HTMLElement;
const summaryEl = document.getElementById("summary")!;
const btnAnalyze = document.getElementById("btn-analyze") as HTMLButtonElement;

KanjiCanvas.init(WORK_CANVAS_ID);

function bboxOf(stroke: Stroke): BBox {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of stroke) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function union(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** 水平方向のギャップ。重なっていれば負(=0扱い)、離れていれば正のピクセル距離。 */
function horizontalGap(a: BBox, b: BBox): number {
  return Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
}

function segment(input: Stroke[], thresholdPx: number): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const stroke of input) {
    const bb = bboxOf(stroke);
    if (!current) {
      current = { strokes: [stroke], bbox: bb };
      continue;
    }
    if (horizontalGap(current.bbox, bb) <= thresholdPx) {
      current.strokes.push(stroke);
      current.bbox = union(current.bbox, bb);
    } else {
      groups.push(current);
      current = { strokes: [stroke], bbox: bb };
    }
  }
  if (current) groups.push(current);
  return groups;
}

function recognizeGroup(group: Group): string[] {
  (KanjiCanvas as unknown as Record<string, unknown>)[`recordedPattern_${WORK_CANVAS_ID}`] = group.strokes;
  const raw = KanjiCanvas.recognize(WORK_CANVAS_ID);
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function redrawInk(): void {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.strokeStyle = "#2f2a26";
  drawCtx.lineWidth = 3;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    drawCtx.beginPath();
    drawCtx.moveTo(stroke[0].x, stroke[0].y);
    for (const p of stroke.slice(1)) drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
  }
}

function clearOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawOverlay(groups: Group[]): void {
  clearOverlay();
  const pad = 6;
  groups.forEach((g, i) => {
    const color = GROUP_COLORS[i % GROUP_COLORS.length];
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeRect(
      g.bbox.minX - pad,
      g.bbox.minY - pad,
      g.bbox.maxX - g.bbox.minX + pad * 2,
      g.bbox.maxY - g.bbox.minY + pad * 2,
    );
    overlayCtx.fillStyle = color;
    overlayCtx.font = "14px sans-serif";
    overlayCtx.fillText(String(i + 1), g.bbox.minX - pad, g.bbox.minY - pad - 4);
  });
}

function pointFromEvent(ev: PointerEvent): Point {
  const rect = drawCanvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

drawCanvas.addEventListener("pointerdown", (ev) => {
  currentStroke = [pointFromEvent(ev)];
  strokes.push(currentStroke);
  drawCanvas.setPointerCapture(ev.pointerId);
});
drawCanvas.addEventListener("pointermove", (ev) => {
  if (!currentStroke) return;
  currentStroke.push(pointFromEvent(ev));
  redrawInk();
});
drawCanvas.addEventListener("pointerup", () => {
  currentStroke = null;
});

function renderPhrase(): void {
  phraseEl.textContent = PHRASES[phraseIndex];
  progressEl.textContent = `${phraseIndex + 1} / ${PHRASES.length}`;
  strokes = [];
  currentStroke = null;
  lastAnalysis = null;
  redrawInk();
  clearOverlay();
  guessEl.textContent = "";
  judgeRowEl.style.display = "none";
  nextRowEl.style.display = "none";
  btnAnalyze.disabled = false;
}

let pendingSegOk: boolean | null = null;
let pendingRecOk: boolean | null = null;

function maybeFinalizeJudgement(): void {
  if (pendingSegOk === null || pendingRecOk === null || !lastAnalysis) return;
  results.push({
    phrase: PHRASES[phraseIndex],
    thresholdPx: Number(thresholdInput.value),
    groupCount: lastAnalysis.groups.length,
    guess: lastAnalysis.guess,
    segmentationOk: pendingSegOk,
    recognitionOk: pendingRecOk,
  });
  nextRowEl.style.display = "flex";
  judgeRowEl.style.display = "none";
  btnAnalyze.disabled = true;
}

function onAnalyze(): void {
  if (strokes.length === 0) {
    guessEl.textContent = "まだ何も書いていません";
    return;
  }
  const thresholdPx = Number(thresholdInput.value);
  const groups = segment(strokes, thresholdPx);
  drawOverlay(groups);
  const guess = groups.map((g) => recognizeGroup(g)[0] ?? "?").join(" ");
  lastAnalysis = { groups, guess };
  guessEl.textContent = `${groups.length}グループ → ${guess}`;
  pendingSegOk = null;
  pendingRecOk = null;
  judgeRowEl.style.display = "flex";
}

function onNext(): void {
  phraseIndex++;
  if (phraseIndex >= PHRASES.length) {
    renderSummary();
    return;
  }
  renderPhrase();
}

function renderSummary(): void {
  progressEl.textContent = "完了";
  phraseEl.textContent = "";
  document.querySelector(".canvas-wrap")!.setAttribute("style", "display:none");
  document.querySelectorAll(".row").forEach((el) => el.setAttribute("style", "display:none"));
  guessEl.textContent = "";

  const segOk = results.filter((r) => r.segmentationOk).length;
  const recOk = results.filter((r) => r.recognitionOk).length;
  const rowsHtml = results
    .map(
      (r) =>
        `<tr><td>${r.phrase}</td><td>${r.groupCount}</td><td>${r.guess}</td><td>${r.thresholdPx}px</td><td>${r.segmentationOk ? "OK" : "NG"}</td><td>${r.recognitionOk ? "OK" : "NG"}</td></tr>`,
    )
    .join("");

  summaryEl.innerHTML = `
    <table>
      <tr><th>フレーズ</th><th>分割数</th><th>認識結果</th><th>しきい値</th><th>分割</th><th>認識</th></tr>
      ${rowsHtml}
    </table>
    <p>分割OK: ${segOk}/${results.length} ／ 認識OK: ${recOk}/${results.length}</p>
    <p>下のJSONをそのままチームへ共有できます。</p>
    <textarea readonly>${JSON.stringify(results, null, 2)}</textarea>
  `;
}

thresholdInput.addEventListener("input", () => {
  thresholdValueEl.textContent = thresholdInput.value;
});
thresholdValueEl.textContent = thresholdInput.value;

btnAnalyze.addEventListener("click", onAnalyze);
document.getElementById("btn-clear")!.addEventListener("click", () => {
  strokes = [];
  currentStroke = null;
  lastAnalysis = null;
  redrawInk();
  clearOverlay();
  guessEl.textContent = "";
  judgeRowEl.style.display = "none";
});
document.getElementById("btn-undo")!.addEventListener("click", () => {
  strokes.pop();
  lastAnalysis = null;
  redrawInk();
  clearOverlay();
  guessEl.textContent = "";
  judgeRowEl.style.display = "none";
});
document.getElementById("seg-ok")!.addEventListener("click", () => {
  pendingSegOk = true;
  maybeFinalizeJudgement();
});
document.getElementById("seg-ng")!.addEventListener("click", () => {
  pendingSegOk = false;
  maybeFinalizeJudgement();
});
document.getElementById("rec-ok")!.addEventListener("click", () => {
  pendingRecOk = true;
  maybeFinalizeJudgement();
});
document.getElementById("rec-ng")!.addEventListener("click", () => {
  pendingRecOk = false;
  maybeFinalizeJudgement();
});
document.getElementById("btn-next")!.addEventListener("click", onNext);

renderPhrase();
