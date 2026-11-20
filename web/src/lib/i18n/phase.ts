import type { Phase } from '@classroom/shared';
import type { MessageKey } from './messages';

/** 階段 → 訊息 key（三個畫面共用）。 */
const PHASE_KEYS: Record<Phase, MessageKey> = {
  preparing: 'phase.preparing',
  open: 'phase.open',
  closed: 'phase.closed',
};

/** 依語言取得階段名稱。 */
export function phaseLabel(
  t: (key: MessageKey) => string,
  phase: Phase,
): string {
  return t(PHASE_KEYS[phase]);
}
