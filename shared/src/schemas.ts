/**
 * 指令與 HTTP 請求的 zod schema（依 contracts/socket-events.md、
 * contracts/http-api.md 與 research R11）。
 *
 * 只檢查「格式」；業務規則錯誤（組名空白／過長／重複、倒數範圍、
 * 重設需確認等）由伺服器 domain 層依各自的錯誤代碼判斷。
 */
import { z } from 'zod';
import {
  COMMAND_EVENTS,
  ERROR_CODES,
  type CommandEvent,
} from './protocol.js';

export const phaseSchema = z.enum(['preparing', 'open', 'closed']);

export const roleSchema = z.enum(['guest', 'student', 'teacher']);

export const errorCodeSchema = z.enum(ERROR_CODES);

/* ------------------------------------------------------------------ */
/* Socket 指令（前端 → 伺服器）                                        */
/* ------------------------------------------------------------------ */

export const groupCreateSchema = z.object({
  name: z.string(),
});

export const groupRenameSchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
});

export const groupDeleteSchema = z.object({
  groupId: z.string().min(1),
});

export const activityOpenSchema = z.object({
  countdownSeconds: z.number().int().optional(),
});

export const activityCloseSchema = z.object({});

export const activityResetSchema = z.object({
  confirm: z.unknown().optional(),
});

export const studentLeaveSchema = z.object({});

export const questionsConfirmSchema = z.object({
  importId: z.string().min(1),
});

/** 學生送出整題所有空格答案；組別只由連線身分決定。 */
export const answerSubmitSchema = z.strictObject({
  questionNumber: z.number().int().positive(),
  answers: z.array(z.string()),
});

/** 老師作廢某組某題。 */
export const answerVoidSchema = z.strictObject({
  groupId: z.string().min(1),
  questionNumber: z.number().int().positive(),
});

/** 各指令事件對應的 schema，供指令路由查表驗證。 */
export const commandSchemas: {
  [E in CommandEvent]: z.ZodType<unknown>;
} = {
  'group:create': groupCreateSchema,
  'group:rename': groupRenameSchema,
  'group:delete': groupDeleteSchema,
  'activity:open': activityOpenSchema,
  'activity:close': activityCloseSchema,
  'activity:reset': activityResetSchema,
  'student:leave': studentLeaveSchema,
  'questions:confirm': questionsConfirmSchema,
  'answer:submit': answerSubmitSchema,
  'answer:void': answerVoidSchema,
};

export const commandEventSchema = z.enum(COMMAND_EVENTS);

/** 指令回覆。 */
export const ackSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: errorCodeSchema, message: z.string() }),
  }),
]);

/** session:invalid 事件的內容。 */
export const sessionInvalidSchema = z.object({
  code: z.literal('GROUP_NOT_FOUND'),
});

/* ------------------------------------------------------------------ */
/* HTTP 請求                                                           */
/* ------------------------------------------------------------------ */

export const teacherLoginSchema = z.object({
  password: z.string().min(1),
});

export const studentJoinSchema = z.object({
  groupId: z.string().min(1),
});

export const importLinkRequestSchema = z.object({
  url: z.string(),
});

/* 匯出推斷型別方便前後端使用。 */
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GroupRenameInput = z.infer<typeof groupRenameSchema>;
export type GroupDeleteInput = z.infer<typeof groupDeleteSchema>;
export type ActivityOpenInput = z.infer<typeof activityOpenSchema>;
export type ActivityResetInput = z.infer<typeof activityResetSchema>;
export type QuestionsConfirmInput = z.infer<typeof questionsConfirmSchema>;
export type AnswerSubmitInput = z.infer<typeof answerSubmitSchema>;
export type AnswerVoidInput = z.infer<typeof answerVoidSchema>;
export type TeacherLoginInput = z.infer<typeof teacherLoginSchema>;
export type StudentJoinInput = z.infer<typeof studentJoinSchema>;
export type ImportLinkRequestInput = z.infer<typeof importLinkRequestSchema>;
export type AckInput = z.infer<typeof ackSchema>;
