import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionStatus } from '../src/features/shared/ConnectionStatus';

describe('ConnectionStatus', () => {
  afterEach(() => {
    cleanup();
  });

  it('第一次連線時顯示「連線中…」', () => {
    render(<ConnectionStatus connectionState="connecting" />);

    expect(screen.getByRole('status').textContent).toBe('連線中…');
  });

  it('斷線後顯示「重新連線中…」', () => {
    render(<ConnectionStatus connectionState="reconnecting" />);

    expect(screen.getByRole('status').textContent).toBe('重新連線中…');
  });

  it('connected 時不顯示提示', () => {
    render(<ConnectionStatus connectionState="connected" />);

    expect(screen.queryByRole('status')).toBeNull();
  });
});
