import { createFadeVisibility } from "./fadeVisibility";
import { notifyClose, notifyOpen } from "./exclusivePopover";
import { FRAME_SHAPE_ORDER, getFrameShape } from "./frameShape";
import type { FrameShapeId } from "./frameShape";
import { FRAME_PATTERN_ORDER, getFramePattern } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import { ICONS } from "./icons";

const SHAPE_ICON: Record<FrameShapeId, string> = {
  round: ICONS.shapeRound,
  oval: ICONS.shapeOval,
  square: ICONS.shapeSquare,
};

const PATTERN_ICON: Record<FramePatternId, string> = {
  matte: ICONS.patternMatte,
  tortoiseshell: ICONS.patternTortoiseshell,
  clear: ICONS.patternClear,
  wood: ICONS.patternWood,
};

/**
 * 共有キャンバス（眼鏡形状）の「見た目の設定」。フレームの形（丸眼鏡/楕円/
 * 長方形）と色（マット/べっ甲/クリア/木目）を1つにまとめ、ルーム作成・選択
 * メニュー（SharedRoomMenu）と同じ.icon-anchor/.icon-popoverパターンの
 * トリガーボタン1つに収める（ユーザー指示）——以前は形・色それぞれに別々の
 * トリガーボタンを並べていたが、指示を受けて1つの「見た目の設定」ボタンの
 * 中で「フレームの形」「フレームの色」の2区画に分けて選ぶ形にした。
 *
 * ルームの一覧選択（決定して閉じる操作）と違い、こちらは形・色を交互に
 * 試しながら決めたい設定なので、選んでもポップアップは閉じない——トリガー
 * ボタンをもう一度押すまで開いたままにする。
 *
 * ルームメニュー（SharedRoomMenu）とは並べて置かれているため、両方同時に
 * 開いていると窮屈（ユーザー指摘）——exclusivePopover経由で、こちらを開くと
 * 向こうが開いていれば自動で閉じる（逆も同様）。
 */
export class AppearanceSelector {
  private anchor: HTMLElement;
  private triggerBtn: HTMLButtonElement;
  private popover: HTMLElement;
  private popoverFade: (show: boolean) => void;
  private open = false;
  private readonly closeRef = () => this.close();

  private shapeId: FrameShapeId;
  private patternId: FramePatternId;
  private onShapeChange: (id: FrameShapeId) => void;
  private onPatternChange: (id: FramePatternId) => void;
  private shapeButtons = new Map<FrameShapeId, HTMLButtonElement>();
  private patternButtons = new Map<FramePatternId, HTMLButtonElement>();

  /** 「メガネ2」(レンズ分割の2組目)専用の値・コールバック(issue #113④)。
   *  「メガネ1」(shapeId/patternId)とは別に個別調整できる——タブ(pairTabRow)で
   *  今どちらを編集中かを切り替え、形・色のボタン群自体はshapeButtons/
   *  patternButtonsを2組で共有する(activePairで表示先を切り替えるだけ)。 */
  private pair2ShapeId: FrameShapeId;
  private pair2PatternId: FramePatternId;
  private onPair2ShapeChange: (id: FrameShapeId) => void;
  private onPair2PatternChange: (id: FramePatternId) => void;
  private activePair: 0 | 1 = 0;
  private pairTabRow: HTMLElement;
  private pairTabButtons = new Map<0 | 1, HTMLButtonElement>();

  constructor(
    container: HTMLElement,
    initialShapeId: FrameShapeId,
    initialPatternId: FramePatternId,
    onShapeChange: (id: FrameShapeId) => void,
    onPatternChange: (id: FramePatternId) => void,
    onPair2ShapeChange: (id: FrameShapeId) => void,
    onPair2PatternChange: (id: FramePatternId) => void
  ) {
    this.shapeId = initialShapeId;
    this.patternId = initialPatternId;
    this.onShapeChange = onShapeChange;
    this.onPatternChange = onPatternChange;
    this.pair2ShapeId = initialShapeId;
    this.pair2PatternId = initialPatternId;
    this.onPair2ShapeChange = onPair2ShapeChange;
    this.onPair2PatternChange = onPair2PatternChange;

    this.anchor = document.createElement("div");
    this.anchor.className = "icon-anchor";

    this.triggerBtn = document.createElement("button");
    this.triggerBtn.type = "button";
    this.triggerBtn.className = "pill-btn appearance-trigger";
    this.triggerBtn.setAttribute("aria-label", "見た目の設定");
    // 画面幅が狭いと3ボタン（ルーム作成・見た目の設定・セッション開始）が
    // 並びきらない（ユーザー指摘）ため、.label-full/.label-shortをCSS側の
    // メディアクエリで出し分けて短縮表示にする（style.css参照）。
    this.triggerBtn.innerHTML = `${ICONS.appearance}<span class="label-full">見た目の設定</span><span class="label-short">見た目</span>`;
    this.triggerBtn.addEventListener("click", () => this.toggle());
    this.anchor.appendChild(this.triggerBtn);

    this.popover = document.createElement("div");
    this.popover.className = "appearance-popover icon-popover";
    this.popover.hidden = true;
    this.popoverFade = createFadeVisibility(this.popover);

    // 「メガネ1」「メガネ2」の切り替えタブ(issue #113④)。共同アイデア出し
    // フェーズ①でレンズ分割が2組になっている(3人以上参加)間だけ表示する
    // ——それ以外は共有キャンバス全体で1つの見た目しか無いため、タブ自体が
    // 意味を持たない(setPair2Visible参照)。
    this.pairTabRow = document.createElement("div");
    this.pairTabRow.className = "shared-menu-section appearance-pair-tabs";
    this.pairTabRow.hidden = true;
    const pairTabPill = document.createElement("div");
    pairTabPill.className = "toolbar-pill";
    for (const [pairIndex, label] of [
      [0, "メガネ1"],
      [1, "メガネ2"],
    ] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn appearance-pair-tab-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => this.selectPair(pairIndex));
      this.pairTabButtons.set(pairIndex, btn);
      pairTabPill.appendChild(btn);
    }
    this.pairTabRow.appendChild(pairTabPill);
    this.popover.appendChild(this.pairTabRow);

    const shapeSection = document.createElement("div");
    shapeSection.className = "shared-menu-section";
    const shapeLabel = document.createElement("div");
    shapeLabel.className = "shared-section-label";
    shapeLabel.textContent = "フレームの形";
    shapeSection.appendChild(shapeLabel);
    const shapeRow = document.createElement("div");
    shapeRow.className = "toolbar-pill";
    for (const id of FRAME_SHAPE_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFrameShape(id).label);
      btn.innerHTML = SHAPE_ICON[id];
      btn.addEventListener("click", () => this.selectShape(id));
      this.shapeButtons.set(id, btn);
      shapeRow.appendChild(btn);
    }
    shapeSection.appendChild(shapeRow);
    this.popover.appendChild(shapeSection);

    const patternSection = document.createElement("div");
    patternSection.className = "shared-menu-section";
    const patternLabel = document.createElement("div");
    patternLabel.className = "shared-section-label";
    patternLabel.textContent = "フレームの色";
    patternSection.appendChild(patternLabel);
    const patternRow = document.createElement("div");
    patternRow.className = "toolbar-pill";
    for (const id of FRAME_PATTERN_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.setAttribute("aria-label", getFramePattern(id).label);
      btn.innerHTML = PATTERN_ICON[id];
      btn.addEventListener("click", () => this.selectPattern(id));
      this.patternButtons.set(id, btn);
      patternRow.appendChild(btn);
    }
    patternSection.appendChild(patternRow);
    this.popover.appendChild(patternSection);

    this.anchor.appendChild(this.popover);
    container.appendChild(this.anchor);

    this.syncShape();
    this.syncPattern();
    this.syncPairTabs();
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.open) return;
    notifyOpen(this.closeRef, this.anchor);
    this.open = true;
    this.triggerBtn.dataset.active = "true";
    this.popoverFade(true);
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.triggerBtn.dataset.active = "false";
    this.popoverFade(false);
    notifyClose(this.closeRef);
  }

  /** 「メガネ1」「メガネ2」タブの切り替え(issue #113④)。形・色のボタン群は
   *  共有なので、タブを切り替えるとその組の今の値に合わせて表示が変わる
   *  だけ——サーバーへの送信はここでは発生しない(ボタンを押した時のみ)。 */
  private selectPair(pairIndex: 0 | 1): void {
    if (pairIndex === this.activePair) return;
    this.activePair = pairIndex;
    this.syncShape();
    this.syncPattern();
    this.syncPairTabs();
  }

  private selectShape(id: FrameShapeId): void {
    if (this.activePair === 1) {
      if (id === this.pair2ShapeId) return;
      this.pair2ShapeId = id;
      this.syncShape();
      this.onPair2ShapeChange(id);
      return;
    }
    if (id === this.shapeId) return;
    this.shapeId = id;
    this.syncShape();
    this.onShapeChange(id);
  }

  private selectPattern(id: FramePatternId): void {
    if (this.activePair === 1) {
      if (id === this.pair2PatternId) return;
      this.pair2PatternId = id;
      this.syncPattern();
      this.onPair2PatternChange(id);
      return;
    }
    if (id === this.patternId) return;
    this.patternId = id;
    this.syncPattern();
    this.onPatternChange(id);
  }

  private syncShape(): void {
    const currentShapeId = this.activePair === 1 ? this.pair2ShapeId : this.shapeId;
    for (const [id, btn] of this.shapeButtons) {
      const active = id === currentShapeId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  private syncPattern(): void {
    const currentPatternId = this.activePair === 1 ? this.pair2PatternId : this.patternId;
    for (const [id, btn] of this.patternButtons) {
      const active = id === currentPatternId;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  private syncPairTabs(): void {
    for (const [pairIndex, btn] of this.pairTabButtons) {
      const active = pairIndex === this.activePair;
      btn.setAttribute("aria-pressed", String(active));
      btn.dataset.active = String(active);
    }
  }

  /** 共有ルームに接続中、編集できない間だけ呼ぶ（main.tsのframe()ループから
   *  毎フレーム呼んでよい——値が変わらない限りDOMは触らない）。編集可能な
   *  全ユーザーに開放されたため(issue #113④)、以前のようにルームマスター
   *  限定ではない。トリガー自体は開けたままにし、今の設定を見られるように
   *  する——押しても反映されないことはボタン自体のdisabled表示で伝える。
   *  タブ切り替え自体はロック中も可能にする(他の組の設定を見られるように)。 */
  setLocked(locked: boolean): void {
    for (const [, btn] of this.shapeButtons) btn.disabled = locked;
    for (const [, btn] of this.patternButtons) btn.disabled = locked;
  }

  /** 「メガネ2」タブ自体の表示/非表示(issue #113④)。共同アイデア出しフェーズ①で
   *  レンズ分割が2組になっている(3人以上参加)間だけmain.tsから呼ばれてtrueになる
   *  ——それ以外では共有キャンバス全体で1つの見た目しか無いため、タブが
   *  意味を持たない。非表示に戻る時、メガネ2を編集中だったら混乱を避けるため
   *  メガネ1表示へ戻す(でないと隠れたタブのままボタン操作がメガネ2へ送られ続ける)。 */
  setPair2Visible(visible: boolean): void {
    if (this.pairTabRow.hidden === !visible) return;
    this.pairTabRow.hidden = !visible;
    if (!visible && this.activePair !== 0) this.selectPair(0);
  }

  /** ルーム側の「メガネ1」の見た目（サーバーに保存された値）を反映する。
   *  ユーザー操作を経ないため、onShapeChange/onPatternChangeは呼ばない——呼ぶと
   *  自分が受け取った値をそのまま送り返すだけの無意味なPATCHが発生してしまう。 */
  setValues(shapeId: FrameShapeId, patternId: FramePatternId): void {
    if (shapeId !== this.shapeId) {
      this.shapeId = shapeId;
      if (this.activePair === 0) this.syncShape();
    }
    if (patternId !== this.patternId) {
      this.patternId = patternId;
      if (this.activePair === 0) this.syncPattern();
    }
  }

  /** setValuesの「メガネ2」版(issue #113④)。 */
  setPair2Values(shapeId: FrameShapeId, patternId: FramePatternId): void {
    if (shapeId !== this.pair2ShapeId) {
      this.pair2ShapeId = shapeId;
      if (this.activePair === 1) this.syncShape();
    }
    if (patternId !== this.pair2PatternId) {
      this.pair2PatternId = patternId;
      if (this.activePair === 1) this.syncPattern();
    }
  }
}
