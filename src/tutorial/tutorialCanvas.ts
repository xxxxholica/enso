import { TUTORIAL_LIFESPAN_MS, tutorialOpacity } from "./tutorialFade";

/**
 * チュートリアル用の仮想キャンバス。実キャンバス（canvasView.ts）・実データ
 * （storage.tsの"memos"）・実ロジック（fade.ts, memoStore.ts）には一切触れない、
 * 閉じたサンドボックス。フェード曲線と「円を描いて復活させる」ジェスチャーの
 * 数式・操作感だけを、体験用の時間スケールで小さく再現する。
 * マウント中に描いたストロークはこのインスタンスの外へ一切保存されず、
 * destroy()で跡形もなく消える。
 */

interface Point {
  x: number;
  y: number;
}

interface TutorialMemo {
  id: string;
  points: Point[];
  lastRevivedAt: number; // performance.now()基準
}

const INK = "oklch(22% 0.012 55)";
const ACCENT = "oklch(55% 0.16 25)";
const HIT_THRESHOLD_PX = 18;
const ROTATE_MIN_RADIUS_PX = 24;
const ROTATE_STEP_RAD = Math.PI * 2;

/** 円（原点中心・半径radius）の内側に点を丸め込む。geometry.tsのclampToCircleと同一の数式。 */
function clampToCircle(p: Point, radius: number): Point {
  const d = Math.hypot(p.x, p.y);
  if (d <= radius) return p;
  const scale = radius / d;
  return { x: p.x * scale, y: p.y * scale };
}

function centroidOf(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** 一筆書きの円相を、生成的な筆致（太さのむら・わずかな歪み）で描く。 */
function strokeBrushArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
  opacity: number,
  color: string,
  seed: number
): void {
  const segments = 48;
  const startRad = (startDeg * Math.PI) / 180;
  const sweepRad = (sweepDeg * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a0 = startRad + sweepRad * t0;
    const a1 = startRad + sweepRad * t1;
    const mid = (t0 + t1) / 2;
    const pressure = Math.sin(Math.PI * Math.min(mid * 1.08, 1));
    const wobble = 1 + 0.06 * Math.sin((mid * 37 + seed) * 6.283);
    ctx.lineWidth = (1.6 + pressure * 4.5) * wobble;
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.sin(mid * 23 + seed) * 1.2, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

export class TutorialCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private memos: TutorialMemo[] = [];
  private nextId = 0;
  /** nullは「まだ道具を選んでいない」状態。実際の道具バーから選ぶまで、
   *  ペンで描くことも選択で掴むこともできない（ユーザー指示：どちらの操作も
   *  自動で切り替えず、道具を選ぶところ自体を体験させる）。 */
  private tool: "pen" | "move" | null = null;
  private interactive = true;
  private mode: "idle" | "drawing" | "moving" = "idle";
  private activeMemoId: string | null = null;
  private lastPoint: Point | null = null;
  private rotateAnchor: Point | null = null;
  private rotateAccumRad = 0;
  private rotateFiredSteps = 0;
  private highlightId: string | null = null;
  private raf = 0;
  private strokeCommittedCb: (() => void) | null = null;
  private memoRevivedCb: ((id: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "tutorial-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    this.resize();
    this.updateCursor();
    window.addEventListener("resize", this.resize);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);

    this.loop();
  }

  setTool(tool: "pen" | "move" | null): void {
    this.tool = tool;
    this.updateCursor();
  }

  /** ステップ「二」「四」「結」など、見せるだけで操作させないステップの間は
   *  ポインタ操作そのものを無視する（進行中のジェスチャーも打ち切る）。 */
  setInteractive(active: boolean): void {
    this.interactive = active;
    if (!active) {
      this.mode = "idle";
      this.activeMemoId = null;
      this.rotateAnchor = null;
      this.lastPoint = null;
    }
    this.updateCursor();
  }

  private updateCursor(): void {
    if (!this.interactive || this.tool === null) {
      this.canvas.style.cursor = "default";
    } else {
      this.canvas.style.cursor = this.tool === "move" ? "grab" : "crosshair";
    }
  }

  onStrokeCommitted(cb: () => void): void {
    this.strokeCommittedCb = cb;
  }

  onMemoRevived(cb: (id: string) => void): void {
    this.memoRevivedCb = cb;
  }

  highlightMemo(id: string | null): void {
    this.highlightId = id;
  }

  firstMemoId(): string | null {
    return this.memos[0]?.id ?? null;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.remove();
  }

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const size = Math.max(1, Math.min(rect.width, rect.height));
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private radiusPx(): number {
    return Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / 2 - 6;
  }

  private toNormalized(ev: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = this.radiusPx();
    return { x: (ev.clientX - cx) / r, y: (ev.clientY - cy) / r };
  }

  private hitTest(p: Point): TutorialMemo | null {
    const threshold = HIT_THRESHOLD_PX / this.radiusPx();
    let best: TutorialMemo | null = null;
    let bestDist = threshold;
    for (const memo of this.memos) {
      for (const pt of memo.points) {
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          best = memo;
        }
      }
    }
    return best;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.canvas.setPointerCapture(ev.pointerId);
    if (!this.interactive || this.tool === null) return;
    const p = this.toNormalized(ev);

    if (this.tool === "pen") {
      const memo: TutorialMemo = {
        id: `memo-${this.nextId++}`,
        points: [clampToCircle(p, 1)],
        lastRevivedAt: performance.now(),
      };
      this.memos.push(memo);
      this.mode = "drawing";
      this.activeMemoId = memo.id;
    } else {
      const hit = this.hitTest(p);
      if (hit) {
        this.mode = "moving";
        this.activeMemoId = hit.id;
        this.rotateAnchor = p;
        this.rotateAccumRad = 0;
        this.rotateFiredSteps = 0;
      }
    }
    this.lastPoint = p;
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.mode === "idle") return;
    const p = this.toNormalized(ev);
    const memo = this.memos.find((m) => m.id === this.activeMemoId);
    if (!memo) return;

    if (this.mode === "drawing") {
      memo.points.push(clampToCircle(p, 1));
    } else if (this.mode === "moving" && this.lastPoint) {
      this.updateRotationGesture(memo, this.lastPoint, p);
    }
    this.lastPoint = p;
  };

  private onPointerUp = (): void => {
    if (this.mode === "drawing") this.strokeCommittedCb?.();
    this.mode = "idle";
    this.activeMemoId = null;
    this.rotateAnchor = null;
    this.lastPoint = null;
  };

  /**
   * canvasView.ts の updateRotationGesture と同じ数式（掴んだ点を固定の支点にし、
   * atan2差分を(-π,π]にラップして積算、2πごとに1ステップ発火）を再現する。
   * ただし本番の「1時間ずつなぞる」ではなく、体験用の圧縮寿命(9秒)に対しては
   * 1時間単位のナッジが意味を持たないため、1ステップ＝満タン復活／即座に消滅
   * とする（操作の感触は同じで、結果の跳び幅だけ体験のスケールに合わせている）。
   */
  private updateRotationGesture(memo: TutorialMemo, prev: Point, cur: Point): void {
    if (!this.rotateAnchor) return;
    const anchor = this.rotateAnchor;
    const prevVec = { x: prev.x - anchor.x, y: prev.y - anchor.y };
    const curVec = { x: cur.x - anchor.x, y: cur.y - anchor.y };
    const minRadius = ROTATE_MIN_RADIUS_PX / this.radiusPx();
    if (Math.hypot(prevVec.x, prevVec.y) < minRadius || Math.hypot(curVec.x, curVec.y) < minRadius) return;

    let delta = Math.atan2(curVec.y, curVec.x) - Math.atan2(prevVec.y, prevVec.x);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta <= -Math.PI) delta += Math.PI * 2;
    this.rotateAccumRad += delta;

    const targetSteps = Math.trunc(this.rotateAccumRad / ROTATE_STEP_RAD);
    while (this.rotateFiredSteps < targetSteps) {
      // 時計回り：一気に寿命を使い切らせる（老化）
      memo.lastRevivedAt = performance.now() - TUTORIAL_LIFESPAN_MS;
      this.rotateFiredSteps++;
    }
    while (this.rotateFiredSteps > targetSteps) {
      // 反時計回り：満タンに復活させる（なぞる／円相の名の由来と同じ動作）
      memo.lastRevivedAt = performance.now();
      this.rotateFiredSteps--;
      this.memoRevivedCb?.(memo.id);
    }
  }

  private loop = (): void => {
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private render(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const r = this.radiusPx();
    const now = performance.now();

    strokeBrushArc(ctx, cx, cy, r, -100, 328, 1, INK, 11);

    for (const memo of this.memos) {
      if (memo.points.length === 0) continue;
      const opacity = tutorialOpacity(now - memo.lastRevivedAt, TUTORIAL_LIFESPAN_MS);
      const isHighlighted = memo.id === this.highlightId;
      const drawOpacity = isHighlighted ? Math.max(opacity, 0.08) : opacity;
      if (drawOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = drawOpacity;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        memo.points.forEach((pt, i) => {
          const x = cx + pt.x * r;
          const y = cy + pt.y * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (memo.points.length === 1) ctx.lineTo(cx + memo.points[0].x * r + 0.5, cy + memo.points[0].y * r);
        ctx.stroke();
        ctx.restore();
      }

      if (isHighlighted) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        const centroid = centroidOf(memo.points);
        ctx.save();
        ctx.globalAlpha = 0.3 + pulse * 0.35;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx + centroid.x * r, cy + centroid.y * r, 16 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
