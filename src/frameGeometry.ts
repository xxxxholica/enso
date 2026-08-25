import { computeAutoScale, computeContainerSize, computeRectSize, computeSquareSize, fitCanvasToContainer } from "./canvasSizing";
import {
  getFrameShape,
  getGlassesFrameShape,
  glassesBridgeHalfWidth,
  GLASSES_HINGE_TAB_HALF_HEIGHT,
  GLASSES_HINGE_TAB_LENGTH,
  GLASSES_HINGE_TAB_RADIUS,
  GLASSES_HORIZONTAL_REACH_WITH_HINGE,
  GLASSES_VERTICAL_REACH,
} from "./frameShape";
import type { FrameShape, FrameShapeId } from "./frameShape";
import { getFramePattern } from "./framePattern";
import type { FramePatternId } from "./framePattern";
import type { Point } from "./types";

export interface FrameGeometryOptions {
  frameShapeId: FrameShapeId;
  frameStrokeColor: string;
  frameStrokeWidth: number | ((canvasSizePx: number) => number);
  frameKind: "single" | "glasses";
  framePatternId: FramePatternId;
  contentScaleFactor?: number | ((size: number) => number);
}

/**
 * `CircularCanvas`（canvasView.ts）からフレーム形状・サイズ計算・縁取りの
 * 描画に関わる状態をひとまとめにしたもの（canvasView.tsが1000行超まで肥大化
 * したための整理、Refactor）。`canvas`/`ctx`/`container`/`dpr`は他の関心事
 * （ポインタ操作・テキスト編集・テンプレート配置など）からも広く参照される
 * 共有インフラのため、ここには持たせず参照として受け取るだけにする——
 * `CircularCanvas`が引き続き所有する。
 *
 * メモの座標は「円の半径を1とする正規化座標」で保存する（中心が原点、
 * 円周上が距離1）。こうしておくとウィンドウサイズが変わって円の物理的な
 * 大きさ（px）が変化しても、既存のメモが縮んで見えたり位置がずれたりしない
 * ——ウィンドウを広げれば単純にその分だけ拡大して描かれる。
 */
export class FrameGeometry {
  private scaleValue = 0;
  private centerPxValue: Point = { x: 0, y: 0 };
  private contentScaleFactor: number | ((size: number) => number) | undefined;
  private frameShapeId: FrameShapeId;
  private frameStrokeColor: string;
  private frameStrokeWidthOption: number | ((canvasSizePx: number) => number);
  /** 実際に使う縁取りの太さ（px）。frameStrokeWidthOptionが関数の場合、
   *  resize()のたびにその時のキャンバス実サイズで解決し直す。 */
  private frameStrokeWidth = 1;
  private frameKindValue: "single" | "glasses";
  private framePatternId: FramePatternId;
  /** クリップ・外枠描画に使うPath2D。scale/frameShapeId/frameStrokeWidthが変わる
   *  resize()/setFrameShape()のタイミングでだけ組み立て直し、render()（毎フレーム）
   *  では使い回す——Path2Dの構築自体は軽くないため。 */
  private framePathValue: Path2D = new Path2D();
  private strokePathValue: Path2D = new Path2D();
  /** 枠のctx.strokeStyle/fillStyleに使う値。frameKind==="glasses"の時だけ
   *  framePatternIdから組み立てる（"single"はframeStrokeColorそのまま）。
   *  rebuildFramePaths()と同じタイミングで組み立て直す。 */
  private frameStyleValue: CanvasPattern | CanvasGradient | string = "";
  /** ブリッジ（接合部）の半分の高さ（scale基準、正規化単位）。frameKind==="glasses"
   *  の時だけ意味を持つ——「接合部をフレームと同じ太さにする」（ユーザー指示）ため、
   *  frameStrokeWidth（px）をその時のscaleで正規化単位に変換した値。
   *  rebuildFramePaths()で組み立て直す。 */
  private glassesBridgeHalfHeight = 0;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private dpr: number;

  constructor(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    container: HTMLElement,
    dpr: number,
    options: FrameGeometryOptions
  ) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.container = container;
    this.dpr = dpr;
    this.frameShapeId = options.frameShapeId;
    this.frameStrokeColor = options.frameStrokeColor;
    this.frameStrokeWidthOption = options.frameStrokeWidth;
    this.frameKindValue = options.frameKind;
    this.framePatternId = options.framePatternId;
    this.contentScaleFactor = options.contentScaleFactor;
    this.resize();
  }

  get scale(): number {
    return this.scaleValue;
  }

  get centerPx(): Point {
    return this.centerPxValue;
  }

  get framePath(): Path2D {
    return this.framePathValue;
  }

  get strokePath(): Path2D {
    return this.strokePathValue;
  }

  get frameStyle(): CanvasPattern | CanvasGradient | string {
    return this.frameStyleValue;
  }

  get frameKind(): "single" | "glasses" {
    return this.frameKindValue;
  }

  /** 今のframeKindに応じたフレーム形状を返す（"glasses"なら眼鏡形状ファミリー、
   *  "single"なら従来通りの単一形状）。 */
  currentShape(): FrameShape {
    return this.frameKindValue === "glasses" ? getGlassesFrameShape(this.frameShapeId) : getFrameShape(this.frameShapeId);
  }

  /** キャンバス要素自体は、利用可能な幅・高さいっぱいの矩形として広げる
   *  （frameKind==="single"）。フレーム（円/楕円/長方形）の描画基準サイズは
   *  これとは別に、利用可能な幅・高さのうち小さい方（上下限だけ設ける）を
   *  そのまま使う——キャンバス領域を画面いっぱいに広げても、フレームの見た目の
   *  大きさ自体は変えないため（issue #83、ユーザー指示）。frameKind==="glasses"の
   *  場合は、正方形ではなくGLASSES_HORIZONTAL_REACH_WITH_HINGE/GLASSES_VERTICAL_REACH比の
   *  横長矩形として広げる——縦横で必要な余白（縁取り・ヒンジぶん）が異なるため、軸ごとに
   *  computeAutoScaleした小さい方をscaleとして採用する。 */
  resize(): void {
    // #app（style.css）はmin-height:100dvhで最低限のみ保証しており、キャンバスの
    // 実サイズ（style幅高さ）自体もその祖先の「中身から決まる高さ」に数えられる
    // ——一度大きく広がった状態のまま次のresize()の計測(getBoundingClientRect)に
    // 入ると、祖先がその大きさに広がったままなのを「利用可能な広さ」として読み取り、
    // 同じ大きさを出し直してしまう（画面を拡大してから縮小しても縮んだ大きさに
    // 戻らない自己参照ループ、ユーザー報告のバグ）。計測の直前に自分自身を一旦
    // 0にして祖先への影響を切ってから測ることで、祖先が実際に縮んだ後の
    // 正しい大きさを読み取れるようにする。
    this.canvas.style.width = "0px";
    this.canvas.style.height = "0px";
    if (this.frameKindValue === "glasses") {
      // ヒンジの鋲がキャンバス要素の外にクリップされないよう、横方向の余白は
      // GLASSES_HORIZONTAL_REACH_WITH_HINGE（鋲ぶんを含む）を基準にする。
      // referenceWidth/Heightはフレーム（眼鏡）の描画基準サイズ専用——
      // キャンバス要素自体はこれとは別にcomputeContainerSize（コンテナいっぱい）
      // を使う。眼鏡は横長のアスペクト比固定のため、縦長スマホでは常に幅で
      // 頭打ちになり、以前はそれがそのままキャンバス要素の高さにもなっていた。
      // "single"と同様に画面全体まで広げるようにした結果、コンテナ（.smui-canvas-wrap）
      // は画面全体に育つのに、実際の<canvas>要素は幅基準の低い高さのまま――という
      // ズレが生まれ、ズーム・パンしてもその低い高さの外（画面の上下）には
      // 絶対に届かなくなっていた（ユーザー指摘・実機確認済み）。
      const aspectRatio = GLASSES_HORIZONTAL_REACH_WITH_HINGE / GLASSES_VERTICAL_REACH;
      const { width: referenceWidth, height: referenceHeight } = computeRectSize(this.container, aspectRatio);
      const containerSize = computeContainerSize(this.container);
      // frameStrokeWidthが関数の場合、ここで確定した高さ（横長なので制約になり
      // やすい辺）を基準に解決する——スケール（scale）自体はこの後の
      // computeAutoScaleで初めて決まるため、scaleではなくwidth/heightという
      // 「確定済みの実寸」を基準にする。
      this.frameStrokeWidth = this.resolveFrameStrokeWidth(referenceHeight);
      const scale = Math.min(
        computeAutoScale(referenceWidth, GLASSES_HORIZONTAL_REACH_WITH_HINGE, this.frameStrokeWidth),
        computeAutoScale(referenceHeight, GLASSES_VERTICAL_REACH, this.frameStrokeWidth)
      );
      this.canvas.style.width = `${containerSize.width}px`;
      this.canvas.style.height = `${containerSize.height}px`;
      this.canvas.width = Math.round(containerSize.width * this.dpr);
      this.canvas.height = Math.round(containerSize.height * this.dpr);
      this.scaleValue = scale;
      this.centerPxValue = { x: containerSize.width / 2, y: containerSize.height / 2 };
    } else {
      const referenceSize = computeSquareSize(this.container);
      const containerSize = computeContainerSize(this.container);
      this.frameStrokeWidth = this.resolveFrameStrokeWidth(referenceSize);
      const { scale, centerPx } = fitCanvasToContainer(
        this.canvas,
        this.container,
        this.dpr,
        this.contentScaleFactor,
        referenceSize,
        containerSize
      );
      this.scaleValue = scale;
      this.centerPxValue = centerPx;
    }
    this.rebuildFramePaths();
  }

  private resolveFrameStrokeWidth(canvasSizePx: number): number {
    return typeof this.frameStrokeWidthOption === "function"
      ? this.frameStrokeWidthOption(canvasSizePx)
      : this.frameStrokeWidthOption;
  }

  /** クリップ境界と外枠線のPath2Dを、今のscale/フレーム形状/縁の太さから組み立て直す。
   *  resize()（コンテナサイズ変化時）とsetFrameShape()（resize()経由）でだけ呼ばれる。 */
  private rebuildFramePaths(): void {
    const shape = this.currentShape();
    // strokePathはframePathを「一定距離（frameStrokeWidth）だけ外側に
    // オフセットした」輪郭として組み立てる——以前はscale自体をscale+
    // frameStrokeWidth/2に置き換える「一様スケール」で近似していたが、直線から
    // 曲線へ切り替わる場所（squareの角、glassesの接合部の付け根）では一様スケール
    // が実際の一定距離オフセットと一致せず、縁取りと内側の紙の間に隙間ができて
    // しまっていた（ユーザー指摘・実測確認済み）。buildPathのoffset引数（scaleは
    // 据え置き、各パーツの大きさにoffsetを足す）を使うことで、この隙間が生まれない。
    //
    // offsetの大きさはframeStrokeWidthそのもの（半分ではない）にする——
    // 塗りつぶし(fill)後に紙でframePathぶんを隠すことで縁取りを表現する今の
    // 方式では、見た目の縁取りの太さ＝strokePathとframePathの差分＝offset
    // そのものになる（以前のctx.stroke()方式は、centerlineをframeStrokeWidth/2
    // だけオフセットしたpathを、さらにlineWidth=frameStrokeWidthでストローク
    // することで両側にframeStrokeWidth/2ずつ広がっていたため、offsetは半分で
    // 良かった——fill方式に変えた際にこの半分だけ残ってしまっており、縁取りが
    // 本来の半分の太さしかなくなっていた。ユーザー指摘）。
    const offset = this.frameStrokeWidth;
    if (this.frameKindValue === "glasses") {
      // 「接合部をフレームと同じ太さに」（ユーザー指示）: ブリッジの半分の高さを
      // frameStrokeWidth（px）から今のscaleで正規化単位に逆算し、buildPathに
      // 渡す——buildPath自体は固定のデフォルト値ではなく、この値でブリッジの
      // 切り欠き位置を決める。
      this.glassesBridgeHalfHeight = this.frameStrokeWidth / 2 / this.scaleValue;
      this.framePathValue = shape.buildPath(this.scaleValue, this.glassesBridgeHalfHeight, 0);
      this.strokePathValue = shape.buildPath(this.scaleValue, this.glassesBridgeHalfHeight, offset);
    } else {
      this.framePathValue = shape.buildPath(this.scaleValue);
      this.strokePathValue = shape.buildPath(this.scaleValue, undefined, offset);
    }
    this.frameStyleValue =
      this.frameKindValue === "glasses"
        ? getFramePattern(this.framePatternId).buildStyle(this.ctx, this.scaleValue * shape.horizontalReach)
        : this.frameStrokeColor;
  }

  /** フレーム形状（丸眼鏡/楕円/長方形）を切り替える。次のrender()から反映される。 */
  setFrameShape(id: FrameShapeId): void {
    this.frameShapeId = id;
    // 動的計算時のscale自体はMAX_SHAPE_REACH基準で形状に関わらず一定だが、
    // クリップ境界・紙の塗り範囲（drawRuledPaperのfillHalfExtent）は形状ごとに
    // 異なるため、次のrender()で正しく反映されるようここでresize()して
    // centerPx等を確定させておく。
    this.resize();
  }

  /** フレームの柄・質感（マット/べっ甲/クリア/木目）を切り替える。
   *  frameKind==="single"では意味を持たない（常にframeStrokeColorの単色）。 */
  setFramePattern(id: FramePatternId): void {
    this.framePatternId = id;
    this.resize();
  }

  /** ヒンジ（フレームの縁から外側に飛び出す小さな角丸タブ）を描く。正面から
   *  見た実物の眼鏡はつる（テンプル）が奥に折れてほぼ見えないため、つるの線は
   *  描かず、縁に付く小さな出っ張りだけを残す（ユーザー指摘・参考イラスト）。
   *  内側の端は縁取りの外側の端（strokePathの実際の見た目の縁）にぴったり付け、
   *  そこから外側にタブを伸ばす——単に外側の水平先端（scale*horizontalReach）
   *  を中心に置くと、縁取りの内側に埋もれて見えてしまうため（ユーザー指摘）。
   *  strokePathはframePathをframeStrokeWidthぶん外側にオフセットした輪郭
   *  （rebuildFramePaths参照）なので、水平方向の実際の外側の縁は
   *  scale*horizontalReach + frameStrokeWidthになる——以前はcomputeOuterReach
   *  （ctx.stroke()でframeStrokeWidth/2ずつ両側に広がっていた旧方式向けの式）を
   *  流用していたが、fillベースの新方式では値が合わずヒンジが縁から離れて
   *  見えてしまっていた（ユーザー指摘）。
   *
   *  タブの大きさはthis.frameStrokeWidth（ウィンドウサイズに応じて動的に
   *  変わりうる）の倍率ではなく、ブリッジと同じthis.scale基準（正規化単位）で
   *  決める——frameStrokeWidthの倍率にすると、フレームを太くするたびにヒンジ
   *  まで連動して肥大化してしまい、独立に調整できない（ユーザー指摘）。 */
  drawGlassesHinges(ctx: CanvasRenderingContext2D, shape: FrameShape): void {
    const frameOuterEdge = this.scaleValue * shape.horizontalReach + this.frameStrokeWidth;
    const tabLength = this.scaleValue * GLASSES_HINGE_TAB_LENGTH;
    const tabHalfHeight = this.scaleValue * GLASSES_HINGE_TAB_HALF_HEIGHT;
    const tabRadius = this.scaleValue * GLASSES_HINGE_TAB_RADIUS;

    for (const direction of [1, -1] as const) {
      const innerX = direction * frameOuterEdge;
      const outerX = innerX + direction * tabLength;
      const left = Math.min(innerX, outerX);

      ctx.beginPath();
      ctx.roundRect(left, -tabHalfHeight, tabLength, tabHalfHeight * 2, tabRadius);
      ctx.fillStyle = this.frameStyleValue;
      ctx.fill();
    }
  }

  /** ブリッジ（接合部）を、フレームと同じ柄・質感で塗りつぶす。書き込める領域は
   *  レンズの内側だけ（clampToGlasses参照）なので、ここは常にフレーム素材で覆い、
   *  紙の罫線を透けさせない——クリップ(framePath)の外側（render()参照）で、
   *  strokePath自身のブリッジの高さ（frameStrokeWidthぶんオフセットした後の高さ、
   *  glassesBridgeHalfHeight*scale + frameStrokeWidth）ぴったりに塗る。
   *
   *  framePath基準の高さ（オフセット前）ぴったりに塗っていた以前の版は、
   *  strokePathの方がブリッジでもoffsetぶん背が高く、framePathの外側
   *  （紙で隠れない）にフレーム色の帯がすでに描かれていた——それをclampToGlasses
   *  でクリップしたbridge-barが覆いきれず、紙とその帯の境目が細い筋として
   *  見えてしまっていた（ユーザー指摘・実測確認済み）。strokePath自身の高さに
   *  合わせて塗ることで、この帯ごと同じ1枚のフィルで覆い、境目自体をなくす。 */
  drawGlassesBridgeBar(ctx: CanvasRenderingContext2D): void {
    const halfWidth = this.scaleValue * glassesBridgeHalfWidth(this.frameShapeId, this.glassesBridgeHalfHeight);
    const halfHeight = this.scaleValue * this.glassesBridgeHalfHeight + this.frameStrokeWidth;
    ctx.fillStyle = this.frameStyleValue;
    ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  }
}
