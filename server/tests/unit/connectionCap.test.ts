import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createConnectionCap } from '../../src/infra/socket/connectionCap.js';

/**
 * 2026-11-21 資安審計 C3：同時在線連線數上限。
 *
 * 這裡用假的 engine 事件驗證「握手中」的保留名額何時釋放——
 * 這段時序在真實網路上難以穩定重現，但它是上限機制正確性的關鍵：
 * 若保留名額沒有在握手結束時釋放，攻擊者只要反覆「握手後立刻斷線」
 * 就能占住所有名額，把其他人全部擋在門外。
 */

/** 假的底層 socket：只需要 `once('close')`。 */
class FakeSocket extends EventEmitter {}

/** 假的 request：只需要 `socket` 與作為 Map key 的物件身分。 */
type FakeRequest = { socket: FakeSocket };

/** 假的 Engine.IO 伺服器：只提供 clientsCount 與兩個事件。 */
function createFakeEngine() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { clientsCount: 0 });
}

function createFakeIo(engine: ReturnType<typeof createFakeEngine>) {
  return { engine } as unknown as Parameters<
    ReturnType<typeof createConnectionCap>['attach']
  >[0];
}

describe('createConnectionCap', () => {
  it('未達上限時放行，超過時拒絕新連線', () => {
    const cap = createConnectionCap({ maxConnections: 2 });
    const engine = createFakeEngine();
    cap.attach(createFakeIo(engine));

    const first = { socket: new FakeSocket() } as unknown as FakeRequest;
    const second = { socket: new FakeSocket() } as unknown as FakeRequest;
    const third = { socket: new FakeSocket() } as unknown as FakeRequest;

    const results: boolean[] = [];
    const allow = (req: FakeRequest): boolean => {
      let success = false;
      cap.allowRequest(
        req as never,
        (_error: string | null | undefined, ok: boolean) => {
          success = ok;
        },
      );
      return success;
    };

    results.push(allow(first));
    results.push(allow(second));
    // 前兩筆只是「握手中」，還沒建立 → 加上保留名額後仍是 2 筆。
    expect(results).toEqual([true, true]);
    expect(allow(third)).toBe(false);
  });

  it('握手完成後名額轉為已建立的連線數', () => {
    const cap = createConnectionCap({ maxConnections: 1 });
    const engine = createFakeEngine();
    cap.attach(createFakeIo(engine));

    const req = { socket: new FakeSocket() } as unknown as FakeRequest;
    let allowed = false;
    cap.allowRequest(req as never, (_error, ok) => {
      allowed = ok;
    });
    expect(allowed).toBe(true);

    // 握手完成：engine 計數 +1，並釋放保留名額。
    engine.clientsCount = 1;
    engine.emit('connection', { request: req });
    expect(cap.currentCount).toBe(1);

    // 下一筆應被拒（已建立的連線已達上限）。
    const next = { socket: new FakeSocket() } as unknown as FakeRequest;
    let nextAllowed = true;
    cap.allowRequest(next as never, (_error, ok) => {
      nextAllowed = ok;
    });
    expect(nextAllowed).toBe(false);
  });

  it('底層 socket 關閉時立刻釋放保留名額（中止的握手不會占住名額）', () => {
    const cap = createConnectionCap({ maxConnections: 1 });
    const engine = createFakeEngine();
    cap.attach(createFakeIo(engine));

    const req = { socket: new FakeSocket() } as unknown as FakeRequest;
    let allowed = false;
    cap.allowRequest(req as never, (_error, ok) => {
      allowed = ok;
    });
    expect(allowed).toBe(true);

    // 攻擊者握手中途斷線 → socket 關閉 → 名額立刻釋放。
    req.socket.emit('close');
    expect(cap.currentCount).toBe(0);

    // 名額已釋放 → 其他人可以連上。
    const next = { socket: new FakeSocket() } as unknown as FakeRequest;
    let nextAllowed = false;
    cap.allowRequest(next as never, (_error, ok) => {
      nextAllowed = ok;
    });
    expect(nextAllowed).toBe(true);
  });

  it('握手失敗時釋放保留名額', () => {
    const cap = createConnectionCap({ maxConnections: 1 });
    const engine = createFakeEngine();
    cap.attach(createFakeIo(engine));

    const req = { socket: new FakeSocket() } as unknown as FakeRequest;
    cap.allowRequest(req as never, () => undefined);
    expect(cap.currentCount).toBe(1);

    engine.emit('connection_error', { req });
    expect(cap.currentCount).toBe(0);
  });

  it('上限為 0 時不限制', () => {
    const cap = createConnectionCap({ maxConnections: 0 });
    const engine = createFakeEngine();
    cap.attach(createFakeIo(engine));

    for (let index = 0; index < 10; index += 1) {
      const req = { socket: new FakeSocket() } as unknown as FakeRequest;
      let allowed = false;
      cap.allowRequest(req as never, (_error, ok) => {
        allowed = ok;
      });
      expect(allowed).toBe(true);
    }
  });
});
