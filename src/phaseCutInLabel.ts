import { PHASE_LABEL } from "./sessionPanel";
import type { SessionState } from "./sharedCanvas";

/**
 * フェーズが実際に切り替わった時だけ、カットインに出す文言を返す
 * （変わっていなければnull＝表示しない）。smuiView.applySession()から、
 * 直前のフェーズ(prevPhase)と新しいセッション状態を渡して呼ぶ。
 */
export function phaseCutInLabel(prevPhase: SessionState["phase"] | null, session: SessionState | null): string | null {
  if (session && session.phase !== prevPhase) return `${PHASE_LABEL[session.phase]}開始`;
  if (!session && prevPhase === "voting") return "結果発表";
  return null;
}
