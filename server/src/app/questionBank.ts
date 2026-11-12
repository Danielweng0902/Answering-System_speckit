/**
 * QuestionBank：活動目前題目的應用層入口，包住 questionRepo。
 * 寫入端（questions:confirm）經過這裡（T017）；快照與 activity:open 的
 * 題目數檢查直接讀 questionRepo（只讀、無商業規則）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { QuestionSummary } from '@classroom/shared';
import {
  count,
  getGuidedNotes,
  list,
  replaceAll,
  type GuidedNotesMeta,
  type GuidedNotesRecord,
  type QuestionInput,
} from '../infra/db/questionRepo.js';

export type QuestionBank = {
  /** 以新的學習單與題目完全取代（須在交易內呼叫，見 importService）。 */
  replace: (guidedNotes: GuidedNotesRecord, questions: QuestionInput[]) => void;
  /** 依原檔順序的題目摘要（快照用）。 */
  listSummaries: () => QuestionSummary[];
  hasQuestions: () => boolean;
  count: () => number;
  /** 學習單資訊（不含原檔位元組）；尚未匯入時為 null。 */
  guidedNotesInfo: () => GuidedNotesMeta | null;
};

export function createQuestionBank(database: DatabaseSync): QuestionBank {
  return {
    replace(guidedNotes, questions) {
      replaceAll(database, guidedNotes, questions);
    },
    listSummaries() {
      return list(database).map((question) => ({
        number: question.number,
        kind: question.kind,
        prompt: question.prompt,
        blankCount: question.blanks.length,
      }));
    },
    hasQuestions() {
      return count(database) > 0;
    },
    count() {
      return count(database);
    },
    guidedNotesInfo() {
      return getGuidedNotes(database);
    },
  };
}
