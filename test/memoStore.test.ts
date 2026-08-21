import { beforeEach, describe, expect, it } from "vitest";
import { MemoStore } from "../src/memoStore";
import type { MemoStyle } from "../src/types";

// jsdom を使わず、localStorage 相当の最小モックだけ用意する
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

const STANDARD: MemoStyle = { tool: "pen", color: "#2f2a26", lifespanDays: null };
const TODAY: MemoStyle = { tool: "pen", color: "#2f2a26", lifespanDays: 1 };

describe("MemoStore", () => {
  it("作成したメモはlocalStorageから復元できる（リロード耐性）", () => {
    const store = new MemoStore();
    store.createMemo({ x: 1, y: 2 }, STANDARD, 1000);

    const reloaded = new MemoStore();
    expect(reloaded.getAll()).toHaveLength(1);
    expect(reloaded.getAll()[0].lifespanDays).toBeNull();
    expect(reloaded.getAll()[0].tool).toBe("pen");
    expect(reloaded.getAll()[0].color).toBe("#2f2a26");
    expect(reloaded.getAll()[0].traceHistory).toEqual([1000]);
  });

  it("なぞって復活させるたびにtraceHistoryへ時刻が追記される（タイムライン再現用）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    expect(store.getAll()[0].traceHistory).toEqual([0]);

    store.reviveMemo(memo.id, 1000);
    store.reviveMemo(memo.id, 2000);
    expect(store.getAll()[0].traceHistory).toEqual([0, 1000, 2000]);
    expect(store.getAll()[0].lastTracedAt).toBe(2000);
  });

  it("7日経過でtickするとstatusがfadedになり、キャンバスから消える", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

    const justBefore = 7 * 24 * 60 * 60 * 1000 - 1;
    store.tick(justBefore);
    expect(store.getActive()).toHaveLength(1);
    expect(store.getFaded()).toHaveLength(0);

    const exactly7Days = 7 * 24 * 60 * 60 * 1000;
    const changed = store.tick(exactly7Days);
    expect(changed).toBe(true);
    expect(store.getActive()).toHaveLength(0);
    expect(store.getFaded()).toHaveLength(1);
    expect(store.getFaded()[0].id).toBe(memo.id);
  });

  it("なぞって復活させるとlastTracedAtが更新され猶予がリセットされる", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);

    const threeDays = 3 * 24 * 60 * 60 * 1000;
    store.tick(threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(0.2);

    store.reviveMemo(memo.id, threeDays);
    expect(store.opacityOf(store.getActive()[0], threeDays)).toBe(1);

    // 復活後はそこから新たに7日でまた消える
    store.tick(threeDays + 7 * 24 * 60 * 60 * 1000 - 1);
    expect(store.getActive()).toHaveLength(1);
    store.tick(threeDays + 7 * 24 * 60 * 60 * 1000);
    expect(store.getActive()).toHaveLength(0);
  });

  it("今日中（lifespanDays=1）は24時間で消える", () => {
    const store = new MemoStore();
    store.createMemo({ x: 0, y: 0 }, TODAY, 0);

    store.tick(24 * 60 * 60 * 1000 - 1);
    expect(store.getActive()).toHaveLength(1);
    store.tick(24 * 60 * 60 * 1000);
    expect(store.getActive()).toHaveLength(0);
  });

  it("resetAllで全メモが消え、以後の読み込みにも影響しない", () => {
    const store = new MemoStore();
    store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    store.createMemo({ x: 1, y: 1 }, STANDARD, 0);
    expect(store.getAll()).toHaveLength(2);

    store.resetAll();
    expect(store.getAll()).toHaveLength(0);

    const reloaded = new MemoStore();
    expect(reloaded.getAll()).toHaveLength(0);
  });

  it("faded済みメモをreviveMemoしても復活しない（アーカイブは非対話）", () => {
    const store = new MemoStore();
    const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
    store.tick(7 * 24 * 60 * 60 * 1000);
    expect(store.getFaded()).toHaveLength(1);

    store.reviveMemo(memo.id, 7 * 24 * 60 * 60 * 1000 + 1);
    expect(store.getActive()).toHaveLength(0);
    expect(store.getFaded()).toHaveLength(1);
  });

  describe("createTextMemo（テキストメモ）", () => {
    it("テキストメモを作成でき、リロード後も復元される", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0, y: 0 },
        "こんにちは",
        ["こんにちは"],
        24,
        0.5,
        0.1,
        { color: "#2f2a26", lifespanDays: null },
        1000
      );
      expect(memo.kind).toBe("text");

      const reloaded = new MemoStore();
      const loaded = reloaded.getAll()[0];
      expect(loaded.kind).toBe("text");
      if (loaded.kind === "text") {
        expect(loaded.text).toBe("こんにちは");
        expect(loaded.textLines).toEqual(["こんにちは"]);
        expect(loaded.fontSize).toBe(24);
        expect(loaded.boxWidth).toBe(0.5);
        expect(loaded.boxHeight).toBe(0.1);
      }
    });

    it("テキストメモにはstartStroke/addPointToLastStrokeが効かない（手描き専用の操作のため）", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.5,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
      store.startStroke(memo.id, { x: 1, y: 1 });
      store.addPointToLastStroke(memo.id, { x: 2, y: 2 });
      const reloaded = store.getAll()[0];
      expect(reloaded.kind).toBe("text");
      if (reloaded.kind === "text") {
        expect(reloaded.text).toBe("note");
      }
    });

    it("消しゴムがテキストのボックスに触れるとメモごと削除される（部分削除はしない）", () => {
      const store = new MemoStore();
      store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
      expect(store.getActive()).toHaveLength(1);

      const changed = store.eraseAt({ x: 0.05, y: 0 }, 0.02);
      expect(changed).toBe(true);
      expect(store.getActive()).toHaveLength(0);
    });

    it("消しゴムがテキストのボックスから離れていれば消えない", () => {
      const store = new MemoStore();
      store.createTextMemo(
        { x: 0, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );
      const changed = store.eraseAt({ x: 5, y: 5 }, 0.1);
      expect(changed).toBe(false);
      expect(store.getActive()).toHaveLength(1);
    });
  });

  describe("translateMemo（移動道具でのドラッグ移動）", () => {
    it("手描きメモの全ストロークの点が同じだけ平行移動し、代表座標(x/y)も追従する", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 0.2, y: 0 });

      store.translateMemo(memo.id, 0.1, 0.1);

      const updated = store.getActive()[0];
      expect(updated.kind).toBe("stroke");
      if (updated.kind === "stroke") {
        expect(updated.strokes[0][0].x).toBeCloseTo(0.1);
        expect(updated.strokes[0][0].y).toBeCloseTo(0.1);
        expect(updated.strokes[0][1].x).toBeCloseTo(0.3);
        expect(updated.strokes[0][1].y).toBeCloseTo(0.1);
      }
      expect(updated.x).toBeCloseTo(0.1);
      expect(updated.y).toBeCloseTo(0.1);
    });

    it("テキストメモは代表座標(x/y)がそのまま平行移動する", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.1, y: 0.1 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );

      store.translateMemo(memo.id, 0.05, -0.02);

      const updated = store.getActive()[0];
      expect(updated.x).toBeCloseTo(0.15);
      expect(updated.y).toBeCloseTo(0.08);
    });

    it("円の外に出そうな移動は半径1にクランプされ、円からはみ出さない", () => {
      const store = new MemoStore();
      const memo = store.createTextMemo(
        { x: 0.9, y: 0 },
        "note",
        ["note"],
        24,
        0.4,
        0.1,
        { color: "#000", lifespanDays: null },
        0
      );

      store.translateMemo(memo.id, 0.5, 0); // (0.9,0) -> (1.4,0) のはずだがクランプされる

      const updated = store.getActive()[0];
      const d = Math.hypot(updated.x, updated.y);
      expect(d).toBeLessThanOrEqual(1 + 1e-9);
      expect(updated.x).toBeCloseTo(1);
      expect(updated.y).toBeCloseTo(0);
    });

    it("消滅済み（振り返りビュー）のメモは動かせない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.tick(7 * 24 * 60 * 60 * 1000);
      expect(store.getFaded()).toHaveLength(1);

      store.translateMemo(memo.id, 0.5, 0.5);

      const stillFaded = store.getFaded()[0];
      expect(stillFaded.x).toBe(0);
      expect(stillFaded.y).toBe(0);
    });

    it("移動はなぞって復活と無関係：traceHistory/lastTracedAtは変化しない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      const before = store.getActive()[0].traceHistory.slice();
      const beforeTracedAt = store.getActive()[0].lastTracedAt;

      store.translateMemo(memo.id, 0.1, 0.1);

      const updated = store.getActive()[0];
      expect(updated.traceHistory).toEqual(before);
      expect(updated.lastTracedAt).toBe(beforeTracedAt);
    });
  });

  describe("eraseAt（消しゴム: 本当の手動削除）", () => {
    it("消しゴムが触れた部分だけを取り除き、線を分断する", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      // x=0..20 の直線を1本のストロークとして積む
      for (let x = 2; x <= 20; x += 2) {
        store.addPointToLastStroke(memo.id, { x, y: 0 });
      }

      // 中央 (x=10) を消す → 左右2本に分断されるはず
      const changed = store.eraseAt({ x: 10, y: 0 }, 2);
      expect(changed).toBe(true);
      const updated = store.getActive()[0];
      expect(updated.strokes.length).toBeGreaterThanOrEqual(2);
      // 消した場所の近くに点が残っていないこと
      const anyPointNearCenter = updated.strokes
        .flat()
        .some((p) => Math.abs(p.x - 10) < 2);
      expect(anyPointNearCenter).toBe(false);
    });

    it("メモの全ストロークを消すとメモごと削除される", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 1, y: 0 });
      store.addPointToLastStroke(memo.id, { x: 2, y: 0 });

      store.eraseAt({ x: 1, y: 0 }, 100); // 十分大きい半径で全消し
      expect(store.getActive()).toHaveLength(0);
      expect(store.getAll()).toHaveLength(0);
    });

    it("消滅済み（振り返りビュー）のメモには影響しない", () => {
      const store = new MemoStore();
      const memo = store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      store.addPointToLastStroke(memo.id, { x: 1, y: 0 });
      store.tick(7 * 24 * 60 * 60 * 1000);
      expect(store.getFaded()).toHaveLength(1);

      store.eraseAt({ x: 0, y: 0 }, 100);
      expect(store.getFaded()).toHaveLength(1);
    });

    it("何にも触れなければ何も変わらない", () => {
      const store = new MemoStore();
      store.createMemo({ x: 0, y: 0 }, STANDARD, 0);
      const changed = store.eraseAt({ x: 9999, y: 9999 }, 5);
      expect(changed).toBe(false);
      expect(store.getActive()).toHaveLength(1);
    });
  });
});
