/**
 * 通訊協定型別：依 specs/001-activity-session/contracts/socket-events.md
 * 與 contracts/http-api.md 定義，前後端共用。
 */

export type Phase = 'preparing' | 'open' | 'closed';

export type Role = 'guest' | 'student' | 'teacher';

/** 快照中的組別摘要（依建立順序排列）。 */
export type GroupSummary = { id: string; name: string };

export type SnapshotBase = {
  revision: number;
  /** ISO 8601，供倒數校正。 */
  serverNow: string;
  phase: Phase;
  countdownEndsAt: string | null;
  groups: GroupSummary[];
};

export type GuestSnapshot = SnapshotBase & { role: 'guest' };

type StudentSnapshotBase = SnapshotBase & {
  role: 'student';
  myGroupId: string;
  /** 本次活動的前端草稿識別（FR-027）。 */
  sessionId: string;
};

export type StudentPreparingSnapshot = StudentSnapshotBase & {
  phase: 'preparing';
};

export type StudentOpenSnapshot = StudentSnapshotBase & {
  phase: 'open';
  questions: StudentQuestion[];
  /** 每題固定一筆，只含本組狀態與答案；open 一定沒有 rank。 */
  myAnswers: StudentOpenAnswer[];
};

export type StudentClosedSnapshot = StudentSnapshotBase & {
  phase: 'closed';
  questions: StudentQuestion[];
  /** 每題固定一筆；winner 為 null 表示無有效作答（FR-023、FR-025）。 */
  results: QuestionResult[];
  /** 每題固定一筆，含本組順位；未送出或作廢的 rank 為 null（FR-024）。 */
  myAnswers: StudentClosedAnswer[];
};

export type StudentSnapshot =
  | StudentPreparingSnapshot
  | StudentOpenSnapshot
  | StudentClosedSnapshot;

/** 老師快照中的學習單資訊（不含原檔位元組）。 */
export type GuidedNotesInfo = {
  sheetName: string;
  sourceKind: 'link' | 'file';
  fileName: string | null;
  importedAt: string;
};

/**
 * presence：groupId → 在線連線數；questions／guidedNotes 為 002 匯入的
 * 題目摘要。三個欄位都只有老師快照有（FR-016）。
 */
export type TeacherSnapshot = SnapshotBase & {
  role: 'teacher';
  presence: Record<string, number>;
  questions: QuestionSummary[];
  guidedNotes: GuidedNotesInfo | null;
  /** 003（FR-019–FR-022）：任何階段都有的題 × 組作答看板與整體進度。 */
  board: AnswerBoardQuestion[];
  progress: AnswerProgress;
};

export type Snapshot = GuestSnapshot | StudentSnapshot | TeacherSnapshot;

/* ------------------------------------------------------------------ */
/* Guided Notes 匯入（002 contracts）                                  */
/* ------------------------------------------------------------------ */

export type QuestionKind = 'single' | 'group';

export type QuestionSummary = {
  number: number;
  kind: QuestionKind;
  prompt: string;
  blankCount: number;
};

/* ------------------------------------------------------------------ */
/* 作答與搶答結果（003 contracts）                                      */
/* ------------------------------------------------------------------ */

export type StudentQuestion = {
  number: number;
  kind: QuestionKind;
  prompt: string;
  blanks: { position: number; prefix: string }[];
};

export type AnswerState = 'not_submitted' | 'submitted' | 'voided';

export type StudentOpenAnswer = {
  questionNumber: number;
  state: AnswerState;
  /** open 不含 rank；未送出時為空陣列。 */
  answers: string[];
};

export type StudentClosedAnswer = {
  questionNumber: number;
  state: AnswerState;
  answers: string[];
  /** 只有本組有有效作答時才有順位。 */
  rank: number | null;
};

export type QuestionResult = {
  questionNumber: number;
  winner: {
    groupId: string;
    groupName: string;
    answers: string[];
  } | null;
};

export type AnswerBoardCell = {
  questionNumber: number;
  groupId: string;
  groupName: string;
  state: AnswerState;
  answers: string[];
  /** 作廢時仍保留答案與原順位；未送出為 [] 與 null。 */
  rank: number | null;
};

export type AnswerBoardQuestion = {
  questionNumber: number;
  cells: AnswerBoardCell[];
  winnerGroupId: string | null;
};

export type AnswerProgress = {
  perQuestion: { questionNumber: number; submittedGroupCount: number }[];
  perGroup: { groupId: string; submittedQuestionCount: number }[];
};

export type ImportWarningCode =
  | 'NUMBERS_NOT_SEQUENTIAL'
  | 'BLANK_HAS_CONTENT'
  | 'MULTIPLE_SHEETS_WITH_HEADER';

export type ImportWarning =
  | {
      code: 'NUMBERS_NOT_SEQUENTIAL';
      message: string;
      numbers: number[];
    }
  | {
      code: 'BLANK_HAS_CONTENT';
      message: string;
      number: number;
      cell: string;
    }
  | {
      code: 'MULTIPLE_SHEETS_WITH_HEADER';
      message: string;
      sheetName: string;
    };

export type ImportSummaryBlank = {
  prefix: string;
  cell: string;
};

export type ImportSummaryQuestion = QuestionSummary & {
  blanks: ImportSummaryBlank[];
};

export type ImportSummary = {
  importId: string;
  sheetName: string;
  questionCount: number;
  blankCount: number;
  questions: ImportSummaryQuestion[];
  warnings: ImportWarning[];
  replacesExisting: boolean;
};

/* ------------------------------------------------------------------ */
/* 錯誤代碼（socket-events.md「錯誤代碼」＋ http-api.md 各端點）        */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = [
  'FORBIDDEN',
  'INVALID_PHASE',
  'INVALID_INPUT',
  'GROUP_NAME_EMPTY',
  'GROUP_NAME_TOO_LONG',
  'GROUP_NAME_DUPLICATE',
  'GROUP_LIMIT_REACHED',
  'GROUP_NOT_FOUND',
  'NO_GROUPS',
  'COUNTDOWN_OUT_OF_RANGE',
  'CONFIRM_REQUIRED',
  'WRONG_PASSWORD',
  'TEACHER_PASSWORD_NOT_SET',
  'TOO_MANY_ATTEMPTS',
  'UNAUTHORIZED',
  'FILE_INVALID',
  'FILE_TOO_LARGE',
  'HEADER_NOT_FOUND',
  'NO_QUESTIONS',
  'NO_GUIDED_NOTES',
  'DUPLICATE_QUESTION_NUMBER',
  'LINK_INVALID',
  'LINK_NOT_SHARED',
  'LINK_UNREACHABLE',
  'IMPORT_EXPIRED',
  'QUESTIONS_REQUIRED',
  'QUESTION_NOT_FOUND',
  'BLANK_COUNT_MISMATCH',
  'ANSWER_EMPTY',
  'ANSWER_TOO_LONG',
  'ALREADY_SUBMITTED',
  'SUBMISSION_NOT_FOUND',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 依 contracts 的訊息範例整理，供伺服器回覆與前端顯示使用。 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  FORBIDDEN: '只有老師可以執行這個操作',
  INVALID_PHASE: '目前階段不能執行這個操作',
  INVALID_INPUT: '輸入的內容格式不正確',
  GROUP_NAME_EMPTY: '請輸入組名',
  GROUP_NAME_TOO_LONG: '組名最多 30 個字',
  GROUP_NAME_DUPLICATE: '已經有同名的組別',
  GROUP_LIMIT_REACHED: '最多只能建立 50 組',
  GROUP_NOT_FOUND: '找不到這個組別，請重新選擇',
  NO_GROUPS: '請先建立至少一個組別',
  COUNTDOWN_OUT_OF_RANGE: '倒數時間需介於 10 秒到 60 分鐘',
  CONFIRM_REQUIRED: '請確認是否重設活動',
  WRONG_PASSWORD: '密碼錯誤',
  TEACHER_PASSWORD_NOT_SET: '系統尚未設定老師密碼，請先設定',
  TOO_MANY_ATTEMPTS: '嘗試次數過多，請稍後再試',
  UNAUTHORIZED: '請先以老師身分登入',
  FILE_INVALID: '無法讀取這個檔案，請上傳 xlsx 格式的學習單',
  FILE_TOO_LARGE: '檔案太大，請上傳 5 MB 以內的 xlsx 檔',
  HEADER_NOT_FOUND: '找不到表頭。學習單需要有一列同時包含「題號」「題目」「作答」三個欄位',
  NO_QUESTIONS: '表頭下方沒有找到任何題號，請確認題號欄填的是數字',
  NO_GUIDED_NOTES: '這個活動沒有匯入過學習單，請先匯入學習單',
  DUPLICATE_QUESTION_NUMBER: '題號重複，請修正後重新匯入',
  LINK_INVALID: '這不是 Google 試算表連結，請貼上 docs.google.com/spreadsheets 開頭的網址',
  LINK_NOT_SHARED: '無法讀取這份試算表，可以改用以下方式：',
  LINK_UNREACHABLE: '無法連線到 Google 試算表，請檢查網路，或下載成 xlsx 後上傳',
  IMPORT_EXPIRED: '匯入摘要已失效，請重新讀取學習單',
  QUESTIONS_REQUIRED: '請先匯入題目',
  QUESTION_NOT_FOUND: '找不到這個題號，請重新整理後再試',
  BLANK_COUNT_MISMATCH: '這一題要填滿所有空格才能送出',
  ANSWER_EMPTY: '每個空格都要填寫答案',
  ANSWER_TOO_LONG: '每個空格最多 200 個字',
  ALREADY_SUBMITTED: '本組已經送出這一題，不能再送出',
  SUBMISSION_NOT_FOUND: '找不到可以作廢的作答，請重新整理後再試',
};

/* ------------------------------------------------------------------ */
/* 指令回覆（Ack）                                                     */
/* ------------------------------------------------------------------ */

export type CommandError = { code: ErrorCode; message: string };

export type Ack = { ok: true } | { ok: false; error: CommandError };

/* ------------------------------------------------------------------ */
/* Socket.IO 事件與指令內容                                            */
/* ------------------------------------------------------------------ */

/** 伺服器 → 前端：完整狀態快照。 */
export const STATE_EVENT = 'state';

/** 伺服器 → 前端：學生 token 對應的組別已不存在。 */
export const SESSION_INVALID_EVENT = 'session:invalid';

export type SessionInvalidPayload = { code: 'GROUP_NOT_FOUND' };

export type GroupCreatePayload = { name: string };
export type GroupRenamePayload = { groupId: string; name: string };
export type GroupDeletePayload = { groupId: string };
export type ActivityOpenPayload = { countdownSeconds?: number | undefined };
export type ActivityClosePayload = Record<string, never>;
export type ActivityResetPayload = { confirm: true };
export type StudentLeavePayload = Record<string, never>;
export type QuestionsConfirmPayload = { importId: string };
export type AnswerSubmitPayload = { questionNumber: number; answers: string[] };
export type AnswerVoidPayload = { groupId: string; questionNumber: number };

export type CommandPayloads = {
  'group:create': GroupCreatePayload;
  'group:rename': GroupRenamePayload;
  'group:delete': GroupDeletePayload;
  'activity:open': ActivityOpenPayload;
  'activity:close': ActivityClosePayload;
  'activity:reset': ActivityResetPayload;
  'student:leave': StudentLeavePayload;
  'questions:confirm': QuestionsConfirmPayload;
  'answer:submit': AnswerSubmitPayload;
  'answer:void': AnswerVoidPayload;
};

export const COMMAND_EVENTS = [
  'group:create',
  'group:rename',
  'group:delete',
  'activity:open',
  'activity:close',
  'activity:reset',
  'student:leave',
  'questions:confirm',
  'answer:submit',
  'answer:void',
] as const;

export type CommandEvent = (typeof COMMAND_EVENTS)[number];

/* ------------------------------------------------------------------ */
/* HTTP API（http-api.md）                                             */
/* ------------------------------------------------------------------ */

export type TeacherLoginRequest = { password: string };
export type TeacherLoginResponse = { token: string; role: 'teacher' };

export type StudentJoinRequest = { groupId: string };
export type StudentJoinResponse = {
  token: string;
  role: 'student';
  groupId: string;
};

export type HealthResponse = { ok: true };

/** HTTP 錯誤回應格式。 */
export type ApiErrorResponse = { error: CommandError };
