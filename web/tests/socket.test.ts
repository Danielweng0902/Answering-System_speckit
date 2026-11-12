import { describe, expect, it, vi } from 'vitest';

const emitWithAck = vi.fn();
const timeout = vi.fn(() => ({ emitWithAck }));
const fakeSocket = {
  connected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  timeout,
};

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/lib/session', () => ({ getToken: () => null }));

const { sendCommand, COMMAND_TIMEOUT_MS } = await import('../src/lib/socket');

describe('sendCommand', () => {
  it('帶逾時送出並回傳伺服器的 ack', async () => {
    emitWithAck.mockResolvedValueOnce({ ok: true });

    await expect(sendCommand('activity:close', {})).resolves.toEqual({ ok: true });
    expect(timeout).toHaveBeenCalledWith(COMMAND_TIMEOUT_MS);
  });

  it('伺服器沒有回覆（逾時）時回傳一般錯誤，而不是永遠等待', async () => {
    emitWithAck.mockRejectedValueOnce(new Error('operation has timed out'));

    const result = await sendCommand('activity:close', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBeNull();
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});
