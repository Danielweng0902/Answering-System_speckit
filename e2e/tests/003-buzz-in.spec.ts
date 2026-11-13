import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { importQuestions } from './helpers.js';

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
  await expect(page.getByRole('list', { name: '組別清單' })).toContainText(
    name,
  );
}

test('US1 基本流程：兩組看到 6 題各自送出，同組 2 秒內看到已送出答案並鎖定（AC-003-01、03、04、05、08）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentOnePartnerContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupOneName = '搶答驗證一組';
    const groupTwoName = '搶答驗證二組';
    await addGroup(teacherPage, groupOneName);
    await addGroup(teacherPage, groupTwoName);

    await importQuestions(teacherPage);

    const studentOnePage = await studentOneContext.newPage();
    const studentOnePartnerPage = await studentOnePartnerContext.newPage();
    const studentTwoPage = await studentTwoContext.newPage();
    for (const [page, groupName] of [
      [studentOnePage, groupOneName],
      [studentOnePartnerPage, groupOneName],
      [studentTwoPage, groupTwoName],
    ] as const) {
      await page.goto('/student');
      await page.getByRole('button', { name: groupName, exact: true }).click();
      await expect(page.getByText('目前階段：準備中')).toBeVisible();
    }

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    for (const page of [
      studentOnePage,
      studentOnePartnerPage,
      studentTwoPage,
    ]) {
      await expect(page.getByText('目前階段：搶答中')).toBeVisible();
      await expect(
        page.getByRole('region', { name: /^第 [1-6] 題$/ }),
      ).toHaveCount(6);
    }

    const firstQuestionOnSender = studentOnePage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestionOnSender
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(firstQuestionOnSender.getByRole('alert')).toContainText(
      '每個空格都要填寫答案',
    );

    await firstQuestionOnSender
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 第一組答案');
    const firstQuestionOnPartner = studentOnePartnerPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestionOnPartner
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 第一組答案');

    // 同組兩位成員近乎同時按下真實按鈕；transaction 只接受一筆，另一個
    // 收到 ALREADY_SUBMITTED，並由快照顯示本組已送出的答案（AC-003-06、04）。
    const senderSubmit = firstQuestionOnSender.getByRole('button', {
      name: '送出第 1 題',
      exact: true,
    });
    const partnerSubmit = firstQuestionOnPartner.getByRole('button', {
      name: '送出第 1 題',
      exact: true,
    });
    await Promise.all([
      senderSubmit.evaluate((button) => button.click()),
      partnerSubmit.evaluate((button) => button.click()),
    ]);
    await expect
      .poll(
        async () =>
          [
            ...(await firstQuestionOnSender
              .getByRole('alert')
              .allTextContents()),
            ...(await firstQuestionOnPartner
              .getByRole('alert')
              .allTextContents()),
          ].join(' '),
        { timeout: 2_000 },
      )
      .toContain('本組已經送出這一題，不能再送出');

    for (const question of [firstQuestionOnSender, firstQuestionOnPartner]) {
      await expect(
        question.getByRole('button', { name: '已送出', exact: true }),
      ).toBeDisabled({ timeout: 2_000 });
      await expect(
        question.getByText('本組已送出：e2e 第一組答案', { exact: true }),
      ).toBeVisible({ timeout: 2_000 });
      await expect(question.getByLabel('第 1 題答案')).toBeDisabled({
        timeout: 2_000,
      });
      await expect(question.getByLabel('第 1 題答案')).toHaveValue(
        'e2e 第一組答案',
        { timeout: 2_000 },
      );
      // 鎖定後沒有再送出的操作；同時送出與重複 ack 由 server 整合測試涵蓋。
      await expect(
        question.getByRole('button', { name: '送出第 1 題', exact: true }),
      ).toHaveCount(0);
    }

    const firstQuestionOnOtherGroup = studentTwoPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestionOnOtherGroup
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 第二組答案');
    await firstQuestionOnOtherGroup
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      firstQuestionOnOtherGroup.getByText('本組已送出：e2e 第二組答案', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      firstQuestionOnOtherGroup.getByText('e2e 第一組答案'),
    ).toHaveCount(0);
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentOnePartnerContext.close();
    await studentTwoContext.close();
  }
});

test('US2 離場流程：送出 → 結束 → 重設 → 離開後回到選組畫面（T025）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupName = '離場驗證組';
    await addGroup(teacherPage, groupName);
    await importQuestions(teacherPage);

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage
      .getByRole('button', { name: groupName, exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：搶答中')).toBeVisible();

    // 該組曾有作答事件，學生 revision 會比 guest 快照的 revision 大。
    const firstQuestion = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestion
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 離場答案');
    await firstQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      firstQuestion.getByText('本組已送出：e2e 離場答案', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });

    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：已結束')).toBeVisible();

    await teacherPage
      .getByRole('button', { name: '重設活動', exact: true })
      .click();
    await teacherPage
      .getByRole('button', { name: '確認重設', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    // 同一連線降級為 guest 後，畫面必須回到選組（GroupPicker 可見）。
    await studentPage
      .getByRole('button', { name: '更換組別', exact: true })
      .click();
    await expect(
      studentPage.getByRole('heading', { name: '選擇組別', exact: true }),
    ).toBeVisible();
    await expect(
      studentPage.getByRole('button', { name: groupName, exact: true }),
    ).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});

test('US4 結果畫面：每題 winner 與答案、本組答案與順位、未作答與無人作答、重新整理不變（AC-003-17–21；SC-005）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupOneName = '結果驗證一組';
    const groupTwoName = '結果驗證二組';
    await addGroup(teacherPage, groupOneName);
    await addGroup(teacherPage, groupTwoName);
    await importQuestions(teacherPage);

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

    async function submitAnswer(
      page: Page,
      questionNumber: number,
      answer: string,
    ): Promise<void> {
      const question = page.getByRole('region', {
        name: `第 ${questionNumber} 題`,
        exact: true,
      });
      await question
        .getByLabel(`第 ${questionNumber} 題答案`, { exact: true })
        .fill(answer);
      await question
        .getByRole('button', {
          name: `送出第 ${questionNumber} 題`,
          exact: true,
        })
        .click();
      await expect(
        question.getByText(`本組已送出：${answer}`, { exact: true }),
      ).toBeVisible({ timeout: 2_000 });
    }

    // 第 1 題：一組先送（rank 1、winner）、二組後送（rank 2）。
    await submitAnswer(studentOnePage, 1, 'e2e 結果一組答案');
    await submitAnswer(studentTwoPage, 1, 'e2e 結果二組答案');
    // 第 2 題只有二組送出（rank 1）；第 3 題起無人作答。
    await submitAnswer(studentTwoPage, 2, 'e2e 結果二組第二題');

    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();

    // SC-005：學生畫面在 2 秒內切到結果（AC-003-17）。
    for (const page of [studentOnePage, studentTwoPage]) {
      await expect(
        page.getByRole('heading', { name: '結果區', exact: true }),
      ).toBeVisible({ timeout: 2_000 });
      // 結束後沒有任何送出入口；伺服器端拒絕由整合測試涵蓋（AC-003-20、31）。
      await expect(
        page.getByRole('button', { name: /^送出第 \d+ 題/ }),
      ).toHaveCount(0);
    }

    function resultQuestion(page: Page, questionNumber: number) {
      return page.getByRole('region', {
        name: `第 ${questionNumber} 題`,
        exact: true,
      });
    }

    // 兩組都看到第 1 題 winner 是一組與其答案（AC-003-17）。
    for (const page of [studentOnePage, studentTwoPage]) {
      const questionOne = resultQuestion(page, 1);
      await expect(questionOne).toContainText(`搶答成功：${groupOneName}`);
      await expect(
        questionOne.getByText('答案：e2e 結果一組答案', { exact: true }),
      ).toBeVisible();
    }

    // 一組：自己的答案與第 1 順位（AC-003-18）。
    const groupOneQuestionOne = resultQuestion(studentOnePage, 1);
    await expect(
      groupOneQuestionOne.getByText('本組答案：e2e 結果一組答案', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      groupOneQuestionOne.getByText('本組順位：第 1 順位', { exact: true }),
    ).toBeVisible();
    // 一組第 2 題未作答，winner 是二組（AC-003-18）。
    const groupOneQuestionTwo = resultQuestion(studentOnePage, 2);
    await expect(groupOneQuestionTwo).toContainText(
      `搶答成功：${groupTwoName}`,
    );
    await expect(
      groupOneQuestionTwo.getByText('本組未作答', { exact: true }),
    ).toBeVisible();

    // 二組：第 1 題自己第 2 順位、第 2 題 winner 且第 1 順位。
    const groupTwoQuestionOne = resultQuestion(studentTwoPage, 1);
    await expect(
      groupTwoQuestionOne.getByText('本組答案：e2e 結果二組答案', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      groupTwoQuestionOne.getByText('本組順位：第 2 順位', { exact: true }),
    ).toBeVisible();
    const groupTwoQuestionTwo = resultQuestion(studentTwoPage, 2);
    await expect(groupTwoQuestionTwo).toContainText(
      `搶答成功：${groupTwoName}`,
    );
    await expect(
      groupTwoQuestionTwo.getByText('答案：e2e 結果二組第二題', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      groupTwoQuestionTwo.getByText('本組答案：e2e 結果二組第二題', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      groupTwoQuestionTwo.getByText('本組順位：第 1 順位', { exact: true }),
    ).toBeVisible();

    // 第 3 題沒有任何組別送出 → 無人作答（AC-003-19）。
    for (const page of [studentOnePage, studentTwoPage]) {
      const questionThree = resultQuestion(page, 3);
      await expect(
        questionThree.getByText('無人作答', { exact: true }),
      ).toBeVisible();
      await expect(
        questionThree.getByText('本組未作答', { exact: true }),
      ).toBeVisible();
    }

    // 重新整理後結果相同（AC-003-21）。
    await studentTwoPage.reload();
    await expect(
      studentTwoPage.getByRole('heading', { name: '結果區', exact: true }),
    ).toBeVisible();
    const reloadedQuestionOne = resultQuestion(studentTwoPage, 1);
    await expect(reloadedQuestionOne).toContainText(
      `搶答成功：${groupOneName}`,
    );
    await expect(
      reloadedQuestionOne.getByText('本組答案：e2e 結果二組答案', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      reloadedQuestionOne.getByText('本組順位：第 2 順位', { exact: true }),
    ).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
  }
});

test('US5 題組：第 1、2 題顯示兩個前綴欄，缺填被拒、填滿整題送出，看板與結果逐格依序顯示（AC-003-22–25）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupName = '題組驗證組';
    await addGroup(teacherPage, groupName);
    await importGroupQuestions(teacherPage);

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage
      .getByRole('button', { name: groupName, exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：搶答中')).toBeVisible();

    for (const questionNumber of [1, 2]) {
      const question = studentPage.getByRole('region', {
        name: `第 ${questionNumber} 題`,
        exact: true,
      });
      await expect(question.getByRole('textbox')).toHaveCount(2);
      await expect(question.getByText('（1）', { exact: true })).toBeVisible();
      await expect(question.getByText('（2）', { exact: true })).toBeVisible();
      await expect(
        question.getByLabel(`第 ${questionNumber} 題（1）答案`, { exact: true }),
      ).toBeVisible();
      await expect(
        question.getByLabel(`第 ${questionNumber} 題（2）答案`, { exact: true }),
      ).toBeVisible();
    }

    const firstQuestion = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestion
      .getByLabel('第 1 題（1）答案', { exact: true })
      .fill('e2e 題組第一格');
    await firstQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(firstQuestion.getByRole('alert')).toContainText(
      '每個空格都要填寫答案；尚未填寫的空格：（2）',
    );
    await expect(
      firstQuestion.getByRole('button', { name: '已送出', exact: true }),
    ).toHaveCount(0);

    await firstQuestion
      .getByLabel('第 1 題（2）答案', { exact: true })
      .fill('e2e 題組第二格');
    await firstQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      firstQuestion.getByText('本組已送出：e2e 題組第一格、e2e 題組第二格', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      firstQuestion.getByRole('button', { name: '已送出', exact: true }),
    ).toBeDisabled();
    await expect(
      firstQuestion.getByLabel('第 1 題（1）答案', { exact: true }),
    ).toBeDisabled();
    await expect(
      firstQuestion.getByLabel('第 1 題（2）答案', { exact: true }),
    ).toBeDisabled();

    // AC-003-25（老師側，T040）：看板的題組答案逐格顯示、以位置標示，
    // 順序即資料順序；teacher 快照只有 blankCount，沒有原始前綴。
    const board = teacherPage.getByRole('region', { name: '作答看板' });
    const boardHeaders = await board.locator('thead th').allTextContents();
    const boardColumn = boardHeaders.findIndex(
      (text) => text.trim() === groupName,
    );
    expect(boardColumn).toBeGreaterThan(0);
    const boardCell = board
      .getByRole('row', { name: /^第 1 題/ })
      .getByRole('cell')
      .nth(boardColumn - 1);
    await expect(
      boardCell.getByText('第 1 格：e2e 題組第一格', { exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      boardCell.getByText('第 2 格：e2e 題組第二格', { exact: true }),
    ).toBeVisible();
    await expect(boardCell).toContainText('第 1 順位');
    await expect(boardCell).toContainText('搶答成功');
    const boardText = (await boardCell.textContent()) ?? '';
    expect(boardText.indexOf('第 1 格：e2e 題組第一格')).toBeLessThan(
      boardText.indexOf('第 2 格：e2e 題組第二格'),
    );
    // 單題（第 3 題未送出）不受題組顯示影響。
    await expect(
      board
        .getByRole('row', { name: /^第 3 題/ })
        .getByRole('cell')
        .nth(boardColumn - 1)
        .getByText('未送出', { exact: true }),
    ).toBeVisible();

    // AC-003-25（學生側，T040）：結束後結果畫面的題組答案逐格顯示，
    // 以原始前綴標示並依前綴順序（closed 快照的 questions 帶有 blanks.prefix）。
    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();
    await expect(
      studentPage.getByRole('heading', { name: '結果區', exact: true }),
    ).toBeVisible({ timeout: 2_000 });
    const resultOne = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await expect(
      resultOne.getByText(`搶答成功：${groupName}`, { exact: true }),
    ).toBeVisible();
    await expect(
      resultOne.getByText('答案：（1）e2e 題組第一格、（2）e2e 題組第二格', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resultOne.getByText('本組答案：（1）e2e 題組第一格、（2）e2e 題組第二格', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resultOne.getByText('本組順位：第 1 順位', { exact: true }),
    ).toBeVisible();
    // 第 3 題是單題且無人作答，顯示不受題組處理影響。
    const resultThree = studentPage.getByRole('region', {
      name: '第 3 題',
      exact: true,
    });
    await expect(
      resultThree.getByText('無人作答', { exact: true }),
    ).toBeVisible();
    await expect(
      resultThree.getByText('本組未作答', { exact: true }),
    ).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});

test('US3 看板與進度：送出後 2 秒內更新順位與搶答成功、進度正確，closed 維持內容（AC-003-13–16；SC-003）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupOneName = '看板驗證一組';
    const groupTwoName = '看板驗證二組';
    await addGroup(teacherPage, groupOneName);
    await addGroup(teacherPage, groupTwoName);
    await importQuestions(teacherPage);

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

    // AC-003-13、15：未送出時看板該組格子顯示未送出、進度為 0。
    // e2e 環境留有其他測試建立的組別，所以依表頭欄位索引定位本測試的組別。
    const board = teacherPage.getByRole('region', { name: '作答看板' });
    await expect(board).toBeVisible();

    async function boardCell(questionNumber: number, groupName: string) {
      const headers = await board.locator('thead th').allTextContents();
      const column = headers.findIndex((text) => text.trim() === groupName);
      expect(column).toBeGreaterThan(0);
      const row = board.getByRole('row', {
        name: new RegExp(`^第 ${questionNumber} 題`),
      });
      return row.getByRole('cell').nth(column - 1);
    }

    for (const questionNumber of [1, 2]) {
      for (const groupName of [groupOneName, groupTwoName]) {
        await expect(
          (await boardCell(questionNumber, groupName)).getByText('未送出', {
            exact: true,
          }),
        ).toBeVisible();
      }
    }
    await expect(
      board.getByText('第 1 題：0 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 0 題`, { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupTwoName}：已送出 0 題`, { exact: true }),
    ).toBeVisible();

    async function submitAnswer(
      page: Page,
      questionNumber: number,
      answer: string,
    ): Promise<void> {
      const question = page.getByRole('region', {
        name: `第 ${questionNumber} 題`,
        exact: true,
      });
      await question
        .getByLabel(`第 ${questionNumber} 題答案`, { exact: true })
        .fill(answer);
      await question
        .getByRole('button', {
          name: `送出第 ${questionNumber} 題`,
          exact: true,
        })
        .click();
      await expect(
        question.getByText(`本組已送出：${answer}`, { exact: true }),
      ).toBeVisible({ timeout: 2_000 });
    }

    // AC-003-13、14、SC-003：一組送出第 1 題後 2 秒內看板顯示答案、第 1 順位
    // 與搶答成功標示；二組的格子仍是未送出。
    await submitAnswer(studentOnePage, 1, 'e2e 看板一組答案');
    const groupOneQuestionOne = await boardCell(1, groupOneName);
    await expect(
      groupOneQuestionOne.getByText('已送出：e2e 看板一組答案', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(groupOneQuestionOne).toContainText('第 1 順位');
    await expect(groupOneQuestionOne).toContainText('搶答成功');
    await expect(
      (await boardCell(1, groupTwoName)).getByText('未送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText('第 1 題：1 組送出', { exact: true }),
    ).toBeVisible();

    // 二組送出第 1 題：rank 2、沒有搶答成功標示；進度更新為 2 組。
    await submitAnswer(studentTwoPage, 1, 'e2e 看板二組答案');
    const groupTwoQuestionOne = await boardCell(1, groupTwoName);
    await expect(
      groupTwoQuestionOne.getByText('已送出：e2e 看板二組答案', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(groupTwoQuestionOne).toContainText('第 2 順位');
    await expect(groupTwoQuestionOne).not.toContainText('搶答成功');
    await expect(groupOneQuestionOne).toContainText('搶答成功');
    await expect(
      board.getByText('第 1 題：2 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 1 題`, { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupTwoName}：已送出 1 題`, { exact: true }),
    ).toBeVisible();

    // AC-003-13：二組再送第 2 題，各題順位獨立（第 2 題 rank 1 並搶答成功）。
    await submitAnswer(studentTwoPage, 2, 'e2e 看板二組第二題');
    const groupTwoQuestionTwo = await boardCell(2, groupTwoName);
    await expect(
      groupTwoQuestionTwo.getByText('已送出：e2e 看板二組第二題', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(groupTwoQuestionTwo).toContainText('第 1 順位');
    await expect(groupTwoQuestionTwo).toContainText('搶答成功');
    await expect(
      (await boardCell(2, groupOneName)).getByText('未送出', { exact: true }),
    ).toBeVisible();
    // AC-003-15：進度摘要 — 每題已送出組數與每組已送出題數。
    await expect(
      board.getByText('第 2 題：1 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupTwoName}：已送出 2 題`, { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 1 題`, { exact: true }),
    ).toBeVisible();

    // AC-003-16：結束後看板維持結束當下內容，每題保留搶答成功標示。
    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();
    await expect(teacherPage.getByText('目前階段：已結束')).toBeVisible();
    await expect(groupOneQuestionOne).toContainText('搶答成功');
    await expect(groupOneQuestionOne).toContainText('第 1 順位');
    await expect(groupTwoQuestionOne).toContainText('第 2 順位');
    await expect(groupTwoQuestionTwo).toContainText('搶答成功');
    await expect(board.getByText('第 3 題：0 組送出', { exact: true }))
      .toBeVisible();
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
  }
});

test('US6 草稿與作答保存：重新整理保留已送出與未送出內容，重設後全空（AC-003-26、28、32）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupName = '保存驗證組';
    await addGroup(teacherPage, groupName);
    await importQuestions(teacherPage);

    const studentPage = await studentContext.newPage();
    await studentPage.goto('/student');
    await studentPage
      .getByRole('button', { name: groupName, exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：搶答中')).toBeVisible();

    const firstQuestion = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await firstQuestion
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 已送出的保存答案');
    await firstQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      firstQuestion.getByText('本組已送出：e2e 已送出的保存答案', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });

    const secondQuestion = studentPage.getByRole('region', {
      name: '第 2 題',
      exact: true,
    });
    await secondQuestion
      .getByLabel('第 2 題答案', { exact: true })
      .fill('e2e 尚未送出的草稿');

    // AC-003-26、28：同一分頁重新整理後，已送出的內容由伺服器快照還原，
    // 尚未送出的第二題由本機 localStorage 草稿還原。
    await studentPage.reload();
    await expect(
      studentPage.getByRole('heading', { name: '作答區', exact: true }),
    ).toBeVisible();
    const reloadedFirst = studentPage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await expect(reloadedFirst.getByLabel('第 1 題答案')).toHaveValue(
      'e2e 已送出的保存答案',
    );
    await expect(reloadedFirst.getByLabel('第 1 題答案')).toBeDisabled();
    await expect(
      reloadedFirst.getByRole('button', { name: '已送出', exact: true }),
    ).toHaveCount(1);
    await expect(
      studentPage.getByLabel('第 2 題答案', { exact: true }),
    ).toHaveValue('e2e 尚未送出的草稿');
    expect(
      await studentPage.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith('classroom.buzz-in.drafts.'),
        ),
      ),
    ).toHaveLength(1);

    await teacherPage
      .getByRole('button', { name: '結束搶答', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：已結束')).toBeVisible();
    await teacherPage
      .getByRole('button', { name: '重設活動', exact: true })
      .click();
    await teacherPage
      .getByRole('button', { name: '確認重設', exact: true })
      .click();
    await expect(studentPage.getByText('目前階段：準備中')).toBeVisible();

    // AC-003-32：新 sessionId 啟用時清掉舊 session 草稿；原題目保留，重開
    // 後兩題均回到未送出，不能帶出舊答案或舊草稿。
    await teacherPage
      .getByRole('button', { name: '開啟搶答', exact: true })
      .click();
    await expect(
      studentPage.getByRole('heading', { name: '作答區', exact: true }),
    ).toBeVisible();
    await expect(
      studentPage.getByLabel('第 1 題答案', { exact: true }),
    ).toHaveValue('');
    await expect(
      studentPage.getByLabel('第 2 題答案', { exact: true }),
    ).toHaveValue('');
    await expect(
      studentPage.getByRole('button', { name: '送出第 1 題', exact: true }),
    ).toBeEnabled();
    expect(
      await studentPage.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith('classroom.buzz-in.drafts.'),
        ),
      ),
    ).toEqual([]);
  } finally {
    await teacherContext.close();
    await studentContext.close();
  }
});

test('US3 作廢：取消不生效，確認後該組可重送並得到新 rank、其他組順位與 winner 更新（AC-003-29、30）', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();

  try {
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto('/teacher');
    await teacherPage.getByLabel('老師密碼').fill(requireTeacherPassword());
    await teacherPage.getByRole('button', { name: '登入', exact: true }).click();
    await expect(
      teacherPage.getByRole('button', { name: '開啟搶答', exact: true }),
    ).toBeVisible();
    await resetToPreparing(teacherPage);

    const groupOneName = '作廢驗證一組';
    const groupTwoName = '作廢驗證二組';
    await addGroup(teacherPage, groupOneName);
    await addGroup(teacherPage, groupTwoName);
    await importQuestions(teacherPage);

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

    async function submitAnswer(
      page: Page,
      questionNumber: number,
      answer: string,
    ): Promise<void> {
      const question = page.getByRole('region', {
        name: `第 ${questionNumber} 題`,
        exact: true,
      });
      await question
        .getByLabel(`第 ${questionNumber} 題答案`, { exact: true })
        .fill(answer);
      await question
        .getByRole('button', {
          name: `送出第 ${questionNumber} 題`,
          exact: true,
        })
        .click();
      await expect(
        question.getByText(`本組已送出：${answer}`, { exact: true }),
      ).toBeVisible({ timeout: 2_000 });
    }

    await submitAnswer(studentOnePage, 1, 'e2e 要被作廢的一組答案');
    await submitAnswer(studentTwoPage, 1, 'e2e 二組保留答案');

    const board = teacherPage.getByRole('region', { name: '作答看板' });
    async function boardCell(questionNumber: number, groupName: string) {
      const headers = await board.locator('thead th').allTextContents();
      const column = headers.findIndex((text) => text.trim() === groupName);
      expect(column).toBeGreaterThan(0);
      return board
        .getByRole('row', {
          name: new RegExp(`^第 ${questionNumber} 題`),
        })
        .getByRole('cell')
        .nth(column - 1);
    }

    let groupOneCell = await boardCell(1, groupOneName);
    let groupTwoCell = await boardCell(1, groupTwoName);
    await expect(groupOneCell).toContainText('第 1 順位');
    await expect(groupTwoCell).toContainText('第 2 順位');

    await groupOneCell
      .getByRole('button', { name: '作廢', exact: true })
      .click();
    await expect(
      groupOneCell.getByRole('button', { name: '確認作廢', exact: true }),
    ).toBeVisible();
    await expect(
      groupOneCell.getByRole('button', { name: '取消', exact: true }),
    ).toBeVisible();
    await groupOneCell
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await expect(
      groupOneCell.getByRole('button', { name: '確認作廢', exact: true }),
    ).toHaveCount(0);
    await expect(groupOneCell).toContainText(
      '已送出：e2e 要被作廢的一組答案',
    );
    await expect(
      studentOnePage.getByText('老師已作廢這一題的作答，請重新送出'),
    ).toHaveCount(0);

    await groupOneCell
      .getByRole('button', { name: '作廢', exact: true })
      .click();
    await groupOneCell
      .getByRole('button', { name: '確認作廢', exact: true })
      .click();

    const studentOneQuestion = studentOnePage.getByRole('region', {
      name: '第 1 題',
      exact: true,
    });
    await expect(
      studentOneQuestion.getByText('老師已作廢這一題的作答，請重新送出', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      studentOneQuestion.getByLabel('第 1 題答案', { exact: true }),
    ).toBeEnabled();

    await expect(groupOneCell).toContainText(
      '已作廢：e2e 要被作廢的一組答案',
      { timeout: 2_000 },
    );
    await expect(groupOneCell).toContainText('原第 1 順位');
    await expect(
      groupOneCell.getByRole('button', { name: '作廢', exact: true }),
    ).toHaveCount(0);
    await expect(groupTwoCell).toContainText('第 2 順位');
    await expect(groupTwoCell).toContainText('搶答成功');
    await expect(
      board.getByText('第 1 題：1 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 0 題`, { exact: true }),
    ).toBeVisible();
    await expect(
      studentTwoPage.getByText('老師已作廢這一題的作答，請重新送出'),
    ).toHaveCount(0);
    await expect(
      studentTwoPage.getByText('本組已送出：e2e 二組保留答案', { exact: true }),
    ).toBeVisible();

    await studentOneQuestion
      .getByLabel('第 1 題答案', { exact: true })
      .fill('e2e 一組重新送出答案');
    await studentOneQuestion
      .getByRole('button', { name: '送出第 1 題', exact: true })
      .click();
    await expect(
      studentOneQuestion.getByText('本組已送出：e2e 一組重新送出答案', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 2_000 });

    groupOneCell = await boardCell(1, groupOneName);
    groupTwoCell = await boardCell(1, groupTwoName);
    await expect(groupOneCell).toContainText(
      '已送出：e2e 一組重新送出答案',
      { timeout: 2_000 },
    );
    await expect(groupOneCell).toContainText('第 3 順位');
    await expect(groupTwoCell).toContainText('第 2 順位');
    await expect(groupTwoCell).toContainText('搶答成功');
    await expect(
      board.getByText('第 1 題：2 組送出', { exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText(`${groupOneName}：已送出 1 題`, { exact: true }),
    ).toBeVisible();
  } finally {
    await teacherContext.close();
    await studentOneContext.close();
    await studentTwoContext.close();
  }
});
