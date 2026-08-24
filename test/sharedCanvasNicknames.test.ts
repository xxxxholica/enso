import { beforeEach, describe, expect, it } from "vitest";
import { getAllNicknames, getNickname, setNickname } from "../src/sharedCanvasNicknames";

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

class ThrowingStorage extends MemoryStorage {
  setItem(): void {
    throw new DOMException("QuotaExceededError");
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

describe("sharedCanvasNicknames", () => {
  it("未設定のルームはnullを返す", () => {
    expect(getNickname("room-1")).toBeNull();
  });

  it("設定した名前を取得できる", () => {
    setNickname("room-1", "文化祭の企画");
    expect(getNickname("room-1")).toBe("文化祭の企画");
  });

  it("前後の空白はtrimして保存する", () => {
    setNickname("room-1", "  文化祭の企画  ");
    expect(getNickname("room-1")).toBe("文化祭の企画");
  });

  it("空文字・空白のみを設定すると既存の名前を削除する", () => {
    setNickname("room-1", "文化祭の企画");
    setNickname("room-1", "   ");
    expect(getNickname("room-1")).toBeNull();
  });

  it("getAllNicknamesは全ルーム分をまとめて返す", () => {
    setNickname("room-1", "文化祭の企画");
    setNickname("room-2", "研究室ノート");
    expect(getAllNicknames()).toEqual({ "room-1": "文化祭の企画", "room-2": "研究室ノート" });
  });

  it("localStorageへの書き込みが例外を投げても、呼び出し元に伝播しない", () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new ThrowingStorage();
    expect(() => setNickname("room-1", "文化祭の企画")).not.toThrow();
  });
});
