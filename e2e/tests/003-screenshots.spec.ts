import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const officialGroupFixturePath = fileURLToPath(
  new URL('../../fixtures/guided-notes/02-official-group.xlsx', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const screenshotDirectory = join(
  repositoryRoot,
  'docs/verification/003-screenshots',
);

function requireTeacherPassword(): string {
  const value = process.env.E2E_TEACHER_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error('E2E_TEACHER_PASSWORD 未設定，請透過 Playwright config 注入');
  }
  return value;
}

async function loginAsTeacher(page: Page): Promise<void> {
  await page.goto('/teacher');
  await page.getByLabel('老師密碼').fill(requireTeacherPassword());
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '開啟搶答', exact: true }),
  ).toBeVisible();
}

/** 單獨執行也能從共用活動的搶答中或已結束回到準備中。 */
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

async function addGroup(page: Page, name: string): Promise<void> {
  const groupManager = page.getByRole('region', { name: '組別管理' });
  await groupManager.getByLabel('新增組別名稱').fill(name);
  await groupManager
    .getByRole('button', { name: '新增組別', exact: true })
    .click();
  await expect(
    page.getByRole('list', { name: '組別清單' }),
  ).toContainText(name);
}

/** 上傳官方題組範本並確認摘要 4 題 6 空格（第 1、2 題各有兩格）。 */
async function importGroupQuestions(page: Page): Promise<void> {
  await page
    .getByLabel('上傳 xlsx 檔', { exact: true })
    .setInputFiles(officialGroupFixturePath);

  const summary = page.getByRole('region', { name: '匯入摘要' });
  await expect(summary).toContainText('共 4 題、6 個空格');
  await expect(summary).toContainText('第 1、2 題是題組');
  await summary
    .getByRole('button', { name: '確認匯入', exact: true })
    .click();
  await expect(summary).not.toBeVisible();

  await expect(
    page.getByRole('region', { name: '題目清單' }),
  ).toContainText('第 4 題');
}

async function capture(locator: Locator, filename: string): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await locator.page().waitForLoadState('networkidle');
  // locator.screenshot 亦會等待元素停止移動；停用動畫避免擷取到過渡畫面。
  await locator.screenshot({
    animations: 'disabled',
    path: join(screenshotDirectory, filename),
  });
}

test.skip(
  process.env.SCREENSHOTS !== '1',
  '畫面截圖僅在 SCREENSHOTS=1 時執行',
);

test('T051＋T058：擷取作答區（單題與題組）、已送出鎖定、看板與進度、作廢確認、結果畫面與手機寬度作答畫面', async ({
  browser,
}) => {
  await mkdir(screenshotDirectory, { recursive: true });

  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();
  // T058：手機寬度（390×844）context，補學生作答畫面截圖（EXECUTION-PLAYBOOK §10）。
  const mobileStudentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });

  try {
    const teacherPage = await teacherContext.newPage();
    await loginAsTeacher(teacherPage);
    await resetToPreparing(teacherPage);

    const groupOneName = '截圖一組';
    const groupTwoName = '截圖二組';
    await addGroup(teacherPage, groupOneName);
    await addGroup(teacherPage, groupTwoName);
    await importGroupQuestions(teacherPage);

    const studentOnePage = await studentOneContext.newPage();
    const studentTwoPage = await studentTwoContext.newPage();
    for (const [page, groupName] of [
      [studentOnePage, groupOneName],
      [studentTwoPage, groupTwoName],
    ] as const) {
      await page.goto('/student');
      await page.getByRole('button', { name: groupName, exact: true }).click();
      await expect(page.getByText('目前階段：準備中')).toBeVisible();
    }

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    for (const page of [studentOnePage, studentTwoPage]) {
      await expect(page.getByText('目前階段：搶答中')).toBeVisible();
    }

    // 07：手機寬度（390×844）學生作答畫面：同組第二個成員在搶答中加入（AC-001-09），
    // 擷取整個學生頁面（頁首組別與階段、作答區全部題目），第 2 題含未送出草稿。
    const mobileStudentPage = await mobileStudentContext.newPage();
    await mobileStudentPage.goto('/student');
    await mobileStudentPage
      .getByRole('button', { name: groupOneName, exact: true })
      .click();
    await expect(
      mobileStudentPage.getByText('目前階段：搶答中'),
    ).toBeVisible();
    const mobileQuestionTwo = mobileStudentPage.getByRole('region', {
      name: '第 2 題',
      exact: true,
    });
    await mobileQuestionTwo
      .getByLabel('第 2 題（1）答案', { exact: true })
      .fill('手機第一格');
    await mobileQuestionTwo
      .getByLabel('第 2 題（2）答案', { exact: true })
      .fill('手機第二格');
    const mobileStudentPageRegion = mobileStudentPage.getByRole('region', {
      name: '學生端',
    });
    await expect(mobileStudentPageRegion).toBeVisible();
    const mobileStudentWidth = (await mobileStudentPageRegion.boundingBox())
      ?.width;
    // 區域寬度不得超過 viewport 的 390px，證明擷取的是手機寬度版面。
    expect(mobileStudentWidth).toBeLessThanOrEqual(390);
    await capture(mobileStudentPageRegion, '07-student-mobile.png');

    // 01：單題作答（第 3 題，單一輸入欄，含尚未送出的草稿）。
    const singleQuestion = studentOnePage.getByRole('region', {
      name: '第 3 題',
      exact: true,
    });
    await singleQuestion
      .getByLabel('第 3 題答案', { exact: true })
      .fill('示範答案');
    await capture(singleQuestion, '01-answer-area-single.png');

    // 02：題組作答（第 1 題，兩個前綴輸入欄）。
    const groupQuestion = studentOnePage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await groupQuestion
      .getByLabel('第 1 題（1）答案', { exact: true })
      .fill('示範第一格');
    await groupQuestion
      .getByLabel('第 1 題（2）答案', { exact: true })
      .fill('示範第二格');
    await capture(groupQuestion, '02-answer-area-group.png');

    // 03：已送出鎖定（輸入欄與按鈕停用，顯示本組已送出的答案）。
    await groupQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      groupQuestion.getByText('本組已送出：示範第一格、示範第二格', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      groupQuestion.getByRole('button', { name: '已送出', exact: true }),
    ).toBeDisabled();
    await capture(groupQuestion, '03-submitted-locked.png');

    // 第二組送第 1 題（rank 2）、第一組送第 3 題，讓看板內容完整。
    const groupQuestionTwo = studentTwoPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await groupQuestionTwo
      .getByLabel('第 1 題（1）答案', { exact: true })
      .fill('二組第一格');
    await groupQuestionTwo
      .getByLabel('第 1 題（2）答案', { exact: true })
      .fill('二組第二格');
    await groupQuestionTwo
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      groupQuestionTwo.getByText('本組已送出：二組第一格、二組第二格', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await singleQuestion
      .getByRole('button', { name: '送出第 3 題', exact: true })
      .click();
    await expect(
      singleQuestion.getByText('本組已送出：示範答案', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });

    // 04：老師看板與進度（題 × 組狀態、答案、順位、搶答成功與進度摘要）。
    const board = teacherPage.getByRole('region', { name: '作答看板' });
    async function boardCell(questionNumber: number, groupName: string) {
      const headers = await board.locator('thead th').allTextContents();
      const column = headers.findIndex((text) => text.trim() === groupName);
      expect(column).toBeGreaterThan(0);
      return board
        .getByRole('row', { name: new RegExp(`^第 ${questionNumber} 題`) })
        .getByRole('cell')
        .nth(column - 1);
    }

    const oneQuestionOne = await boardCell(1, groupOneName);
    await expect(
      oneQuestionOne.getByText('第 1 格：示範第一格', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      oneQuestionOne.getByText('第 2 格：示範第二格', { exact: true }),
    ).toBeVisible();
    await expect(oneQuestionOne).toContainText('第 1 順位');
    await expect(oneQuestionOne).toContainText('搶答成功');
    const twoQuestionOne = await boardCell(1, groupTwoName);
    await expect(twoQuestionOne).toContainText('第 2 順位');
    const oneQuestionThree = await boardCell(3, groupOneName);
    await expect(
      oneQuestionThree.getByText('已送出：示範答案', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      board.getByText('第 1 題：2 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 2 題`, { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupTwoName}：已送出 1 題`, { exact: true }),
    ).toBeVisible();
    await capture(board, '04-teacher-board-progress.png');

    // 05：作廢確認（第一次按作廢只展開確認／取消，不直接送出指令）。
    await oneQuestionOne
      .getByRole('button', { name: '作廢', exact: true })
      .click();
    await expect(
      oneQuestionOne.getByRole('button', { name: '確認作廢', exact: true }),
    ).toBeVisible();
    await expect(
      oneQuestionOne.getByRole('button', { name: '取消', exact: true }),
    ).toBeVisible();
    await capture(oneQuestionOne, '05-void-confirm.png');
    await oneQuestionOne
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await expect(
      oneQuestionOne.getByRole('button', { name: '確認作廢', exact: true }),
    ).toHaveCount(0);

    // 06：結果畫面（每題搶答成功組別與答案、本組答案與順位、無人作答）。
    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();
    await expect(
      studentOnePage.getByRole('heading', { name: '結果區', exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    const results = studentOnePage.getByRole('region', { name: '結果區' });
    const resultOne = results.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await expect(resultOne).toContainText(`搶答成功：${groupOneName}`);
    await expect(
      resultOne.getByText('答案：（1）示範第一格、（2）示範第二格', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resultOne.getByText('本組順位：第 1 順位', { exact: true }),
    ).toBeVisible();
    const resultTwo = results.getByRole('region', {
      name: '第 2 題',
      exact: true,
    });
    await expect(resultTwo.getByText('無人作答', { exact: true })).toBeVisible();
    await capture(results, '06-student-results.png');
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
    await mobileStudentContext.close();
  }
});
