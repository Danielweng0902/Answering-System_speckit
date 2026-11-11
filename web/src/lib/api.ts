import {
  ERROR_MESSAGES,
  type ApiErrorResponse,
  type ErrorCode,
  type StudentJoinResponse,
  type TeacherLoginResponse,
} from '@classroom/shared';

const GENERIC_LOGIN_ERROR = '目前無法登入，請稍後再試';
const GENERIC_JOIN_ERROR = '目前無法進場，請稍後再試';

export type LoginTeacherResult =
  | { ok: true; token: string }
  | {
      ok: false;
      error: { code: ErrorCode | null; message: string };
    };

export type JoinStudentResult =
  | { ok: true; token: string; groupId: string }
  | {
      ok: false;
      error: { code: ErrorCode | null; message: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    Object.hasOwn(ERROR_MESSAGES, value.error.code) &&
    typeof value.error.message === 'string'
  );
}

function isTeacherLoginResponse(
  value: unknown,
): value is TeacherLoginResponse {
  return (
    isRecord(value) &&
    value.role === 'teacher' &&
    typeof value.token === 'string'
  );
}

function isStudentJoinResponse(
  value: unknown,
): value is StudentJoinResponse {
  return (
    isRecord(value) &&
    value.role === 'student' &&
    typeof value.token === 'string' &&
    typeof value.groupId === 'string'
  );
}

/** 依老師登入 HTTP 合約送出密碼，並保留伺服器提供的使用者錯誤訊息。 */
export async function loginTeacher(
  password: string,
): Promise<LoginTeacherResult> {
  let response: Response;

  try {
    response = await fetch('/api/teacher/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return {
      ok: false,
      error: { code: null, message: GENERIC_LOGIN_ERROR },
    };
  }

  let body: unknown;

  try {
    body = (await response.json()) as unknown;
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: isApiErrorResponse(body)
        ? body.error
        : { code: null, message: GENERIC_LOGIN_ERROR },
    };
  }

  if (!isTeacherLoginResponse(body)) {
    return {
      ok: false,
      error: { code: null, message: GENERIC_LOGIN_ERROR },
    };
  }

  return { ok: true, token: body.token };
}

/** 依學生進場 HTTP 合約選擇組別，並保留伺服器提供的錯誤訊息。 */
export async function joinStudent(groupId: string): Promise<JoinStudentResult> {
  let response: Response;

  try {
    response = await fetch('/api/student/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    });
  } catch {
    return {
      ok: false,
      error: { code: null, message: GENERIC_JOIN_ERROR },
    };
  }

  let body: unknown;

  try {
    body = (await response.json()) as unknown;
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: isApiErrorResponse(body)
        ? body.error
        : { code: null, message: GENERIC_JOIN_ERROR },
    };
  }

  if (!isStudentJoinResponse(body)) {
    return {
      ok: false,
      error: { code: null, message: GENERIC_JOIN_ERROR },
    };
  }

  return { ok: true, token: body.token, groupId: body.groupId };
}
