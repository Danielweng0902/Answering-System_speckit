import type { Socket } from 'socket.io';
import {
  COMMAND_EVENTS,
  ERROR_MESSAGES,
  commandSchemas,
  type Ack,
  type ErrorCode,
} from '@classroom/shared';
import type { AccessIdentity } from '../../app/access.js';
import { getSocketIdentity } from './broadcaster.js';

/** Socket.IO events that the contract allows a command router to handle. */
export type RegisteredCommandEvent = (typeof COMMAND_EVENTS)[number];

/** Identity roles accepted by a command before its use case is invoked. */
export type AllowedRole = AccessIdentity['role'];

/**
 * A command use case receives the connection identity and the payload after
 * zod validation. Its return value decides both the ack and broadcasting.
 */
export type CommandUseCase = (
  identity: AccessIdentity,
  payload: unknown,
) => Ack;

export type CommandRouter = {
  register: (
    socket: Socket,
    event: RegisteredCommandEvent,
    allowedRoles: readonly AllowedRole[],
    useCase: CommandUseCase,
  ) => void;
};

type AckCallback = (ack: Ack) => void;

function invalidInput(): Ack {
  return {
    ok: false,
    error: {
      code: 'INVALID_INPUT',
      message: ERROR_MESSAGES.INVALID_INPUT,
    },
  };
}

function forbidden(): Ack {
  return {
    ok: false,
    error: {
      code: 'FORBIDDEN',
      message: ERROR_MESSAGES.FORBIDDEN,
    },
  };
}

function splitArguments(args: unknown[]): {
  payload: unknown;
  acknowledge: AckCallback | undefined;
} {
  const commandArguments = [...args];
  const last = commandArguments.at(-1);
  const acknowledge =
    typeof last === 'function' ? (last as AckCallback) : undefined;

  if (acknowledge) {
    commandArguments.pop();
  }

  return {
    payload: commandArguments.length === 0 ? undefined : commandArguments[0],
    acknowledge,
  };
}

/**
 * Attach one contract command to a socket.
 *
 * Processing order is deliberately fixed:
 * 1. validate the payload with the shared zod schema (`INVALID_INPUT` on
 *    failure),
 * 2. check the stored connection identity (`FORBIDDEN` on failure),
 * 3. execute the use case,
 * 4. only on `{ ok: true }`, broadcast and return the successful ack.
 *
 * A missing Socket.IO ack callback is valid; the command still runs, but no
 * synchronous exception is raised for the acknowledgement itself.
 */
export function registerCommand(
  socket: Socket,
  event: RegisteredCommandEvent,
  allowedRoles: readonly AllowedRole[],
  useCase: CommandUseCase,
  broadcastState: () => void,
): void {
  socket.on(event, (...args: unknown[]) => {
    const { payload, acknowledge } = splitArguments(args);
    const sendAck = (ack: Ack): void => {
      acknowledge?.(ack);
    };

    const parsed = commandSchemas[event].safeParse(payload);
    if (!parsed.success) {
      sendAck(invalidInput());
      return;
    }

    const identity = getSocketIdentity(socket);
    if (!allowedRoles.includes(identity.role)) {
      sendAck(forbidden());
      return;
    }

    let ack: Ack;
    try {
      ack = useCase(identity, parsed.data);
    } catch {
      // 只記錄事件名稱，不記錄 payload 或例外內容（可能含使用者輸入）。
      // contracts 沒有「伺服器內部錯誤」代碼，所以不回覆 ack；資料已由
      // use case 的 transaction ROLLBACK，不廣播。
      console.error(`Command ${event} failed.`);
      return;
    }
    if (ack.ok) {
      broadcastState();
    }
    sendAck(ack);
  });
}

/** Factory kept in index-level code for future phases to register commands. */
export function createCommandRouter(broadcastState: () => void): CommandRouter {
  return {
    register(socket, event, allowedRoles, useCase) {
      registerCommand(socket, event, allowedRoles, useCase, broadcastState);
    },
  };
}

/** Convenience for tests and future use-case adapters that need an Ack. */
export function commandError(code: ErrorCode): Ack {
  return {
    ok: false,
    error: { code, message: ERROR_MESSAGES[code] },
  };
}
