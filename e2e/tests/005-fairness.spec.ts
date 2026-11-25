import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const verificationDirectory = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'docs',
  'verification',
  '005-screenshots',
);

const officialGroupFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/02-official-group.xlsx', import.meta.url),
);

function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定，請透過 Playwright config 注入');
  }
  return value;
}

async function importGroupQuestions(page: Page): Promise<void> {
  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(officialGroupFixturePath);

  const summary = page.getByRole('region', { name: '匯入摘要' });
  await expect(summary).toContainText('共 4 題、6 個空格');
  await summary.getByRole('button', { name: '確認匯入', exact: true }).click();
  await expect(summary).not.toBeVisible();
  await expect(page.getByRole('region', { name: '題目清單' })).toContainText(
    '第 4 題',
  );
}

async function addGroup(page: Page, name: string): Promise<void> {
  const groupManager = page.getByRole('region', { name: '組別管理' });
  await groupManager.getByLabel('新增組別名稱').fill(name);
  await groupManager
    .getByRole('button', { name: '新增組別', exact: true })
    .click();
  await expect(groupManager.getByRole('list', { name: '組別清單' })).toContainText(
    name,
  );
}

async function resetToPreparing(page: Page): Promise<void> {
  if (await page.getByText('目前階段：搶答中').isVisible()) {
    await page.getByRole('button', { name: '結束搶答', exact: true }).click();
    await expect(page.getByText('目前階段：已結束')).toBeVisible();
  }
  if (await page.getByText('目前階段：已結束').isVisible()) {
    await page.getByRole('button', { name: '重設活動', exact: true }).click();
    await page.getByRole('button', { name: '確認重設', exact: true }).click();
    await expect(page.getByText('目前階段：準備中')).toBeVisible();
  }
}

test('US1／US3：公平順位開關、投影看板不外洩作答資訊、逐題揭曉依題號順序（T030）', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const projectorContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const suffix = String(Date.now()).slice(-6);
    const firstGroup = `公平A 組${suffix}`;
    const secondGroup = `公平B 組${suffix}`;
    await addGroup(teacherPage, firstGroup);
    await addGroup(teacherPage, secondGroup);
    await importGroupQuestions(teacherPage);

    // US2：準備中可以切換公平順位。
    const fairnessToggle = teacherPage.getByRole('switch', {
      name: '啟用公平順位',
    });
    await expect(fairnessToggle).not.toBeChecked();
    // 開關是受控元件，勾選狀態以伺服器回應為準，所以點擊後另外等待。
    await fairnessToggle.click();
    await expect(fairnessToggle).toBeChecked();

    const studentOne = await studentContext.newPage();
    await studentOne.goto('/student');
    await studentOne.getByRole('button', { name: firstGroup, exact: true }).click();
    const studentTwo = await studentContext.newPage();
    await studentTwo.goto('/student');
    await studentTwo.getByRole('button', { name: secondGroup, exact: true }).click();

    await teacherPage.getByRole('button', { name: '開啟搶答', exact: true }).click();
    await expect(studentOne.getByText('目前階段：搶答中')).toBeVisible();

    // US3：投影頁需要老師身分（AC-005-18）；登入後只有階段與在線狀態。
    const projectorPage = await projectorContext.newPage();
    await projectorPage.goto('/projector');
    await projectorPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await projectorPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(projectorPage.getByRole('heading', { name: '搶答中' })).toBeVisible();
    await expect(projectorPage.getByText(firstGroup)).toBeVisible();

    const questionOne = studentOne.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    // 02 的第 1 題是題組（兩個空格），整題填完才能送出。
    await questionOne
      .getByLabel('第 1 題（1）答案', { exact: true })
      .fill('答案 A1');
    await questionOne
      .getByLabel('第 1 題（2）答案', { exact: true })
      .fill('答案 A2');
    await questionOne.getByRole('button', { name: '送出第 1 題', exact: true }).click();
    await expect(
      questionOne.getByText('本組已送出：答案 A1、答案 A2', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });

    // AC-005-08：3 秒批次結束後，老師看板要自己從「判定中」變成「搶答成功」，
    // 不需要重新整理（2026-11-25 錄 Demo 時發現會一直停在判定中）。
    const answerBoard = teacherPage.locator('section[aria-labelledby="answer-board-title"]');
    await expect(answerBoard.getByText('搶答成功', { exact: true })).toHaveCount(1, {
      timeout: 6_000,
    });
    await expect(answerBoard.getByText('判定中', { exact: true })).toHaveCount(0);

    // 公平順位改判：兩組在 3 秒內都答第 2 題，成功題數較少的第二組勝出，
    // 因此第 2 題是「改判」（2026-11-19 review：學生端結果頁的改判說明曾把
    // 「本組順位」擠到題號欄，下面會用座標斷言守住同一欄）。
    const questionTwoOne = studentOne.getByRole('region', {
      name: '第 2 題',
      exact: true,
    });
    const questionTwoTwo = studentTwo.getByRole('region', {
      name: '第 2 題',
      exact: true,
    });
    await questionTwoOne
      .getByLabel('第 2 題（1）答案', { exact: true })
      .fill('答案 A1');
    await questionTwoOne
      .getByLabel('第 2 題（2）答案', { exact: true })
      .fill('答案 A2');
    await questionTwoOne
      .getByRole('button', { name: '送出第 2 題', exact: true })
      .click();
    await questionTwoTwo
      .getByLabel('第 2 題（1）答案', { exact: true })
      .fill('答案 B1');
    await questionTwoTwo
      .getByLabel('第 2 題（2）答案', { exact: true })
      .fill('答案 B2');
    await questionTwoTwo
      .getByRole('button', { name: '送出第 2 題', exact: true })
      .click();
    await expect(
      questionTwoOne.getByText('本組已送出：答案 A1、答案 A2', { exact: true }),
    ).toBeVisible();

    // 投影頁在搶答中不得出現任何答案或作答狀態（FR-015、SC-004）。
    await expect(projectorPage.getByText('答案 A1')).toHaveCount(0);
    await expect(projectorPage.getByText('搶答結果')).toHaveCount(0);
    // 學生送出答案後，投影頁仍要停留在看板：廣播路徑以前送「一般老師快照」
    // 給投影連線，前端看到 role 變掉就跳回登入畫面（2026-11-19 review 發現）。
    await expect(projectorPage.getByRole('heading', { name: '搶答中' })).toBeVisible();

    await mkdir(verificationDirectory, { recursive: true });
    await projectorPage.screenshot({
      path: join(verificationDirectory, 'projector-buzzing.png'),
      fullPage: true,
    });
    await teacherPage.screenshot({
      path: join(verificationDirectory, 'teacher-fairness-toggle.png'),
      fullPage: true,
    });

    await teacherPage.getByRole('button', { name: '結束搶答', exact: true }).click();
    await expect(teacherPage.getByText('目前階段：已結束')).toBeVisible();

    // 結果畫面標示本場使用公平順位。
    await expect(studentOne.getByText('本場使用公平順位')).toBeVisible();

    // 改判說明出現，而且它與「本組順位」必須在同一欄（x 座標相同）——
    // 舊的排法會讓「本組順位」被擠到題號欄（2026-11-19 review）。
    const fairnessNote = studentOne.getByText('本題因公平順位改判');
    await expect(fairnessNote).toBeVisible();
    const noteBox = await fairnessNote.boundingBox();
    const rankBox = await studentOne
      .getByText(/本組順位：第/)
      .first()
      .boundingBox();
    expect(noteBox).not.toBeNull();
    expect(rankBox).not.toBeNull();
    expect(Math.abs((noteBox?.x ?? 0) - (rankBox?.x ?? 0))).toBeLessThan(2);

    // 逐題揭曉：依題號順序，第一次只出現第 1 題。
    await teacherPage.getByRole('button', { name: '揭曉下一題', exact: true }).click();
    await expect(projectorPage.getByText('第 1 題')).toBeVisible();
    await expect(projectorPage.getByText('第 2 題')).toHaveCount(0);

    await teacherPage.getByRole('button', { name: '全部揭曉', exact: true }).click();
    await expect(projectorPage.getByText('第 4 題')).toBeVisible();
    await expect(projectorPage.getByText('各組搶答成功題數')).toBeVisible();

    await mkdir(verificationDirectory, { recursive: true });
    await projectorPage.screenshot({
      path: join(verificationDirectory, 'projector-revealed.png'),
      fullPage: true,
    });
    // 學生端結果頁（含「本題因公平順位改判」那一行）：2026-11-19 review 指出
    // 這裡曾有「本組順位」被擠到題號欄的版面問題，修完後補一張截圖當證據。
    await studentOne.screenshot({
      path: join(verificationDirectory, 'student-results-fairness.png'),
      fullPage: true,
    });
  } finally {
    await teacherContext.close();
    await studentContext.close();
    await projectorContext.close();
  }
});
