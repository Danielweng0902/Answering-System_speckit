import type { Phase } from '@classroom/shared';
import styles from './phaseStyle.module.css';

/**
 * 依階段回傳對應的語意色 class（design/DESIGN.md §3 的階段對照表）：
 * 準備中＝墨灰、搶答中＝朱紅、已結束＝藍。
 * 老師端、學生端、投影看板都用這裡，避免三個畫面各寫一套。
 */
export function phaseStyleClass(phase: Phase): string {
  if (phase === 'open') {
    return styles.open ?? '';
  }
  if (phase === 'closed') {
    return styles.closed ?? '';
  }
  return styles.preparing ?? '';
}
