import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    /**
     * 2026-11-22：整合測試會真的開 50～100 組的 Socket.IO 連線、跑 1,000 筆
     * 以上的作答與 50 MB 解壓的檔案案例；在本機最快的也要 2～3.5 秒，CI 跑
     * 器比本機慢兩倍以上時會超過 vitest 預設的 5 秒上限而誤判失敗
     *（第一次 CI 失敗就是這個原因）。
     *
     * 這裡把上限拉到 60 秒：測試本身仍會在真的卡住時失敗（斷言不會被放寬），
     * 只是不會因為「機器慢」而誤報。
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
