// KanjiCanvas が配布時に同梱していなかった、ひらがな・カタカナの参照パターンを
// リポジトリ本体(asdfjkl/kanjicanvas)の hiragana/katakana ディレクトリの手書きストロークXMLから
// 自前でコンパイルするスクリプト。
//
// KanjiCanvas.momentNormalize / extractFeatures は実行時に手描き入力へ適用される正規化・
// 特徴抽出そのものであり、参照データも同じ変換を経ていないと比較が成立しない。
// そのため独自に再実装するのではなく、public/vendor/kanjicanvas/kanji-canvas.js の
// 実コードをそのままこのNodeスクリプトに読み込んで使う（DOM操作の init() 系は呼ばない）。
//
// 実行: node scripts/kanjicanvas-build/compile-kana-patterns.mjs
// 出力: public/vendor/kanjicanvas/ref-patterns-kana.js

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const libSource = readFileSync(
  join(repoRoot, "public", "vendor", "kanjicanvas", "kanji-canvas.js"),
  "utf-8",
);

// kanji-canvas.js はブラウザ想定で、内部で `window.KanjiCanvas = ...` した後は
// 素の `KanjiCanvas` という(グローバルの)識別子で参照している。ブラウザでは window が
// そのままグローバルオブジェクトなので成立するが、Node で単に window を引数として渡すだけの
// サンドボックスだと素の識別子解決ができない。sandbox.window === sandbox としたvmコンテキストを
// 使い、windowをそのコンテキストのグローバルオブジェクト自体にすることで同じ挙動を再現する。
// init()等のDOM依存関数は呼ばないため document は空オブジェクトで十分。
const sandbox = { document: { addEventListener: () => {} } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(libSource, sandbox);
const KanjiCanvas = sandbox.KanjiCanvas;

function parseStrokesXml(xml) {
  const unicodeMatch = xml.match(/<unicode>([0-9a-fA-F]+)<\/unicode>/);
  if (!unicodeMatch) throw new Error("unicode not found");
  const char = String.fromCodePoint(parseInt(unicodeMatch[1], 16));

  const strokes = [];
  const strokeBlocks = xml.match(/<stroke>[\s\S]*?<\/stroke>/g) ?? [];
  for (const block of strokeBlocks) {
    const points = [];
    const pointRe = /<point x="(-?\d+)" y="(-?\d+)"\s*\/>/g;
    let m;
    while ((m = pointRe.exec(block))) {
      points.push([Number(m[1]), Number(m[2])]);
    }
    if (points.length > 0) strokes.push(points);
  }
  return { char, strokes };
}

function compileEntry(char, strokes) {
  const tmpId = "compileTmp";
  KanjiCanvas[`recordedPattern_${tmpId}`] = strokes;
  const normalized = KanjiCanvas.momentNormalize(tmpId);
  const features = KanjiCanvas.extractFeatures(normalized, 20.0);
  return [char, strokes.length, features];
}

function loadDir(dirName) {
  const dir = join(here, "xml", dirName);
  const entries = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".xml")) continue;
    const xml = readFileSync(join(dir, file), "utf-8");
    const { char, strokes } = parseStrokesXml(xml);
    entries.push(compileEntry(char, strokes));
  }
  return entries;
}

const hiragana = loadDir("hiragana");
const katakana = loadDir("katakana");
const all = [...hiragana, ...katakana];

const header = `// 自動生成ファイル。手で編集しないこと。
// 生成元: scripts/kanjicanvas-build/compile-kana-patterns.mjs
// KanjiCanvas本体には同梱されていなかったひらがな・カタカナの参照パターンを、
// asdfjkl/kanjicanvas リポジトリの hiragana/katakana ディレクトリのストロークXMLから
// 生成したもの（kanji-canvas.js 読み込み後、ref-patterns.js の後に読み込むこと）。
// hiragana: ${hiragana.length}件 / katakana: ${katakana.length}件
`;

const body = all.map((entry) => `KanjiCanvas.refPatterns.push(${JSON.stringify(entry)});`).join("\n");

writeFileSync(
  join(repoRoot, "public", "vendor", "kanjicanvas", "ref-patterns-kana.js"),
  header + body + "\n",
  "utf-8",
);

console.log(`hiragana: ${hiragana.length}, katakana: ${katakana.length}, total: ${all.length}`);
