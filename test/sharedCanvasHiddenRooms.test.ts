import { beforeEach, describe, expect, it } from "vitest";
import { hideRoom, isRoomHidden } from "../src/sharedCanvasHiddenRooms";

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

describe("sharedCanvasHiddenRooms", () => {
  it("非表示にしていないルームはfalseを返す", () => {
    expect(isRoomHidden("room-1")).toBe(false);
  });

  it("hideRoomすると以後isRoomHiddenがtrueになる", () => {
    hideRoom("room-1");
    expect(isRoomHidden("room-1")).toBe(true);
    expect(isRoomHidden("room-2")).toBe(false);
  });

  it("同じルームを複数回hideRoomしても壊れない", () => {
    hideRoom("room-1");
    hideRoom("room-1");
    expect(isRoomHidden("room-1")).toBe(true);
  });

  it("localStorageへの書き込みが例外を投げても、呼び出し元に伝播しない", () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new ThrowingStorage();
    expect(() => hideRoom("room-1")).not.toThrow();
  });
});
