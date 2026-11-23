/**
 * 介面訊息表（007 i18n）。
 *
 * 結構：`zhTW` 定義所有 key 與繁體中文內容，`en` 必須是**同樣的 key 集合**
 * （型別上 `Messages = Record<MessageKey, string>`）→ 漏翻譯會在編譯時就爆掉，
 * 不會等到介面上出現空白或中文。
 *
 * 命名：`區域.主題`，全小寫；需要插值的地方用 `{name}`，由 `t()` 取代。
 */
export const zhTW = {
  // ── 通用 ────────────────────────────────────────────────
  'phase.preparing': '準備中',
  'phase.open': '搶答中',
  'phase.closed': '已結束',
  'phase.current': '目前階段：{phase}',
  'group.currentLabel': '目前組別：',
  'group.unknown': '未知組別',
  'language.label': '語言',
  'language.zh': '中文',
  'language.en': 'English',

  // ── 首頁 ────────────────────────────────────────────────
  'home.title': '選擇身分',
  'home.description': '請選擇要進入老師端或學生端。',
  'home.roleLabel': '選擇身分',
  'home.teacher': '老師',
  'home.student': '學生',

  // ── 連線與倒數 ──────────────────────────────────────────
  'connection.connecting': '連線中…',
  'connection.reconnecting': '重新連線中…',
  'countdown.label': '剩餘時間 {time}',
  'countdown.caption': '剩餘時間',
  'question.sr': '第 {number} 題',

  // ── 學生端：作答區 ──────────────────────────────────────
  'answer.title': '作答區',
  'answer.description': '每一題填好答案後按送出，送出代表整組作答。',
  'answer.listLabel': '作答題目',
  'answer.label': '答案',
  'answer.blankLabel': '第{prefix}格',
  'answer.inputLabel': '第 {number} 題答案',
  'answer.inputLabelWithPrefix': '第 {number} 題{prefix}答案',
  'answer.empty': '{blanks}不可為空白',
  'answer.submitted': '本組已送出：{answers}',
  'answer.voided': '老師已作廢這一題的作答，請重新送出',
  'answer.buttonSubmitted': '已送出',
  'answer.buttonSending': '送出第 {number} 題中…',
  'answer.buttonSendingVisible': '送出 Q{number} 中…',
  'answer.buttonSubmit': '送出第 {number} 題',
  'answer.buttonSubmitVisible': '送出 Q{number}',

  // ── 學生端：選組別 ──────────────────────────────────────
  'picker.title': '選擇組別',
  'picker.empty': '老師尚未建立組別',
  'picker.listLabel': '可選組別',

  // ── 學生端 ──────────────────────────────────────────────
  'student.title': '學生端',
  'student.preparingTitle': '等待老師開啟搶答',
  'student.preparingDescription': '請留在這個畫面，老師開始後會自動更新。',
  'student.changeGroup': '更換組別',

  // ── 學生端：結果區 ──────────────────────────────────────
  'results.title': '結果區',
  'results.description':
    '搶答已結束，每一題顯示搶答成功的組別與答案，以及本組的答案與順位。',
  'results.fair': '本場使用公平順位：同批作答依已搶答成功題數排序。',
  'results.firstCome': '本場先到先得：最先送出的組別搶答成功。',
  'results.listLabel': '作答結果',
  'results.noAnswer': '無人作答',
  'results.winner': '搶答成功：{group}',
  'results.fairnessAdjusted': '本題因公平順位改判',
  'results.answer': '答案：{answers}',
  'results.myAnswer': '本組答案：{answers}',
  'results.myRank': '本組順位：第 {rank} 順位',
  'results.voided': '本組作答已被老師作廢：{answers}',
  'results.notSubmitted': '本組未作答',

  // ── 投影看板 ────────────────────────────────────────────
  'projector.title': '投影看板',
  'projector.connecting': '連線中…',
  'projector.loginHint': '請先以老師身分登入，才能使用投影看板。',
  'projector.toTeacher': '前往老師端',
  'projector.ruleFair': '本場使用公平順位',
  'projector.ruleFirstCome': '本場先到先得',
  'projector.groupStatus': '組別在線狀態',
  'projector.online': '在線',
  'projector.offline': '離線',
  'projector.revealTitle': '搶答結果',
  'projector.noReveal': '尚未揭曉任何題目。',
  'projector.noWinner': '無人作答',
  'projector.winCounts': '各組搶答成功題數',
  'projector.winCount': '{count} 題',

  // ── 老師端：作答看板 ────────────────────────────────────
  'board.title': '作答看板',
  'board.description':
    '每一題、每一組的送出狀態、答案與順位；搶答中即時更新。',
  'board.fairNote': '本場使用公平順位：同批作答依已成功題數排序。',
  'board.empty': '尚未匯入題目，看板會在匯入後顯示每題各組的作答狀態。',
  'board.colQuestion': '題目',
  'board.notSubmitted': '未送出',
  'board.submitted': '已送出：',
  'board.rank': '第 {rank} 順位',
  'board.settling': '判定中',
  'board.winner': '搶答成功',
  'board.fairnessAdjusted': '公平順位改判',
  'board.voiding': '作廢中…',
  'board.voidConfirm': '確認作廢',
  'board.cancel': '取消',
  'board.void': '作廢',
  'board.voided': '已作廢：',
  'board.formerRank': '原第 {rank} 順位',
  'board.progressTitle': '作答進度',
  'board.progressListLabel': '每一題已送出的組數',
  'board.progressEntry': '第 {number} 題：{count} 組送出',
  'board.byGroupListLabel': '每一組已送出的題數',
  'board.byGroupEntry': '{group}：已送出 {count} 題',
  'board.blank': '第 {number} 格：{answer}',

  // ── 老師端：組別管理 ────────────────────────────────────
  'groups.title': '組別管理',
  'groups.locked': '組別只能在準備中新增、改名或刪除。',
  'groups.nameLabel': '新增組別名稱',
  'groups.add': '新增組別',
  'groups.empty': '尚未建立組別。',
  'groups.listLabel': '組別清單',
  'groups.online': '在線 {count} 人',
  'groups.offline': '離線',
  'groups.renameLabel': '組別 {name} 的新名稱',
  'groups.save': '儲存',
  'groups.cancel': '取消',
  'groups.rename': '改名',
  'groups.delete': '刪除',
  'groups.deleteConfirm': '確定要刪除「{name}」嗎？',
  'groups.renameAria': '改名 {name}',
  'groups.deleteAria': '刪除 {name}',

  // ── 老師端：搶答控制 ────────────────────────────────────
  'control.title': '搶答控制',
  'control.setCountdown': '設定倒數',
  'control.countdownSeconds': '倒數秒數',
  'control.open': '開啟搶答',
  'control.close': '結束搶答',
  'control.fairness': '啟用公平順位',
  'control.fairnessHint':
    '同一題 3 秒內送出的組別視為同批，批內依「已搶答成功題數」由少到多決定順位。',
  'control.resetConfirmLabel': '確認重設活動',
  'control.resetHint': '重設後回到準備中，組別保留',
  'control.resetConfirm': '確認重設',
  'control.resetCancel': '取消',
  'control.resetActivity': '重設活動',

  // ── 老師端：匯入學習單 ──────────────────────────────────
  'import.sectionLabel': '匯入學習單',
  'import.title': '匯入學習單',
  'import.alternativesLabel': '其他做法',
  'import.alternativeShare': '把共用設定改成知道連結者可檢視',
  'import.alternativeDownload': '下載成 xlsx 後上傳',
  'import.formatHint': '請使用 xlsx 格式、5 MB 以內的學習單',
  'import.linkLabel': 'Google 試算表連結',
  'import.read': '讀取',
  'import.fileLabel': '上傳 xlsx 檔',
  'import.summaryLabel': '匯入摘要',
  'import.summaryTitle': '匯入摘要',
  'import.sheet': '工作表：{name}',
  'import.counts': '共 {questions} 題、{blanks} 個空格',
  'import.questionListLabel': '摘要題目清單',
  'import.questionItem': '第 {number} 題（{detail}）',
  'import.prefix': '前綴：{prefixes}',
  'import.noPrefix': '（無前綴）',
  'import.groupNotice': '第 {numbers} 題是題組',
  'import.warningsTitle': '提醒事項',
  'import.warningsLabel': '提醒事項',
  'import.warningNumbersNotSequential':
    '題號不是從 1 開始或沒有連續（實際題號：{numbers}），匯入前請確認',
  'import.warningBlankHasContent':
    '題號 {number} 的作答格 {cell} 已有內容，匯出時會被取代',
  'import.warningMultipleSheets': '多個工作表都有表頭，已使用「{name}」工作表',
  'import.replaceNotice': '確認後會取代現有題目',
  'import.confirm': '確認匯入',
  'import.cancel': '取消',
  'import.kindSingle': '單題',
  'import.kindGroup': '題組',
  'import.kindDetail': '{kind}，{blanks} 個空格',

  // ── 老師端：題目清單 ────────────────────────────────────
  'list.sectionLabel': '題目清單',
  'list.title': '題目清單',
  'list.empty': '尚未匯入題目',
  'list.listLabel': '已匯入題目',

  // ── 老師端：登入 ────────────────────────────────────────
  'login.title': '老師登入',
  'login.passwordLabel': '老師密碼',
  'login.submitting': '登入中…',
  'login.submit': '登入',

  // ── 老師端 ──────────────────────────────────────────────
  'teacher.title': '老師端',
  'teacher.loginPending': '已送出登入資訊，等待同步老師狀態。',
  'teacher.logout': '登出',
  'teacher.passwordNotSet':
    '伺服器尚未設定老師密碼，請先設定環境變數 TEACHER_PASSWORD 再重新整理本頁。',
  'teacher.exportTitle': '匯出結果',
  'teacher.writeBack': '寫回 Google 試算表',
  'teacher.exportGuided': '匯出 Guided Notes',
  'teacher.exportCsv': '匯出 CSV',
  'teacher.noOnlineSheet':
    '這次的學習單是上傳的 xlsx，沒有線上試算表可以寫回；請用「匯出 Guided Notes」。',
  'teacher.projectorTitle': '投影看板',
  'teacher.openProjector': '開啟投影看板',
  'teacher.revealNext': '揭曉下一題',
  'teacher.revealAll': '全部揭曉',
  'teacher.writeBackNone': '這場沒有搶答成功的答案，沒有需要寫回的儲存格。',
  'teacher.writeBackRemapped':
    '線上試算表的版面位置有變動，答案已自動對到現在的位置，共寫回 {count} 格。',
  'teacher.writeBackDone': '已寫回 {count} 格答案到 Google 試算表。',
} as const;

export type MessageKey = keyof typeof zhTW;
export type Messages = Record<MessageKey, string>;

export const en: Messages = {
  'phase.preparing': 'Preparing',
  'phase.open': 'Buzzing',
  'phase.closed': 'Ended',
  'phase.current': 'Current phase: {phase}',
  'group.currentLabel': 'Current group:',
  'group.unknown': 'Unknown group',
  'language.label': 'Language',
  'language.zh': '中文',
  'language.en': 'English',

  'home.title': 'Choose a role',
  'home.description': 'Pick the teacher or the student view.',
  'home.roleLabel': 'Choose a role',
  'home.teacher': 'Teacher',
  'home.student': 'Student',

  'connection.connecting': 'Connecting…',
  'connection.reconnecting': 'Reconnecting…',
  'countdown.label': '{time} left',
  'countdown.caption': 'TIME LEFT',
  'question.sr': 'Question {number}',

  'answer.title': 'Answer area',
  'answer.description':
    'Fill in each question, then submit — submitting sends the answer for your whole group.',
  'answer.listLabel': 'Questions to answer',
  'answer.label': 'Answer',
  'answer.blankLabel': 'Blank {prefix}',
  'answer.inputLabel': 'Answer for question {number}',
  'answer.inputLabelWithPrefix': 'Answer for question {number} {prefix}',
  'answer.empty': '{blanks} cannot be empty',
  'answer.submitted': 'Your group submitted: {answers}',
  'answer.voided':
    'The teacher voided this answer, please submit again',
  'answer.buttonSubmitted': 'Submitted',
  'answer.buttonSending': 'Submitting question {number}…',
  'answer.buttonSendingVisible': 'Submit Q{number}…',
  'answer.buttonSubmit': 'Submit question {number}',
  'answer.buttonSubmitVisible': 'Submit Q{number}',

  'picker.title': 'Choose your group',
  'picker.empty': 'The teacher has not created any groups yet',
  'picker.listLabel': 'Available groups',

  'student.title': 'Student',
  'student.preparingTitle': 'Waiting for the teacher to start',
  'student.preparingDescription':
    'Stay on this screen; it updates when the teacher starts.',
  'student.changeGroup': 'Change group',

  'results.title': 'Results',
  'results.description':
    'Buzzing has ended. Each question shows the winning group and answer, plus your group’s answer and rank.',
  'results.fair':
    'Fair ranking is on: answers in the same batch are ranked by how many questions each group has already won.',
  'results.firstCome':
    'First come first served: the first group to submit wins.',
  'results.listLabel': 'Results',
  'results.noAnswer': 'No answer',
  'results.winner': 'Won by {group}',
  'results.fairnessAdjusted': 'This question was re-assigned by fair ranking',
  'results.answer': 'Answer: {answers}',
  'results.myAnswer': 'Your answer: {answers}',
  'results.myRank': 'Your rank: {rank}',
  'results.voided': 'The teacher voided your answer: {answers}',
  'results.notSubmitted': 'Your group did not answer',

  'projector.title': 'Projector',
  'projector.connecting': 'Connecting…',
  'projector.loginHint': 'Sign in as a teacher to use the projector.',
  'projector.toTeacher': 'Go to the teacher view',
  'projector.ruleFair': 'Fair ranking is on',
  'projector.ruleFirstCome': 'First come first served',
  'projector.groupStatus': 'Group presence',
  'projector.online': 'Online',
  'projector.offline': 'Offline',
  'projector.revealTitle': 'Results',
  'projector.noReveal': 'No questions revealed yet.',
  'projector.noWinner': 'No answer',
  'projector.winCounts': 'Questions won by each group',
  'projector.winCount': '{count} won',

  'board.title': 'Answer board',
  'board.description':
    'Submission status, answers and ranks for every question and group, updating live.',
  'board.fairNote':
    'Fair ranking is on: answers in the same batch are ranked by questions already won.',
  'board.empty':
    'No questions imported yet — the board fills in once you import some.',
  'board.colQuestion': 'Question',
  'board.notSubmitted': 'Not submitted',
  'board.submitted': 'Submitted: ',
  'board.rank': 'Rank {rank}',
  'board.settling': 'Deciding',
  'board.winner': 'Won',
  'board.fairnessAdjusted': 'Re-assigned by fair ranking',
  'board.voiding': 'Voiding…',
  'board.voidConfirm': 'Void this answer',
  'board.cancel': 'Cancel',
  'board.void': 'Void',
  'board.voided': 'Voided: ',
  'board.formerRank': 'Formerly rank {rank}',
  'board.progressTitle': 'Progress',
  'board.progressListLabel': 'Groups that answered each question',
  'board.progressEntry': 'Question {number}: {count} groups answered',
  'board.byGroupListLabel': 'Questions answered by each group',
  'board.byGroupEntry': '{group}: {count} answered',
  'board.blank': 'Blank {number}: {answer}',

  'groups.title': 'Groups',
  'groups.locked':
    'Groups can only be added, renamed or deleted while preparing.',
  'groups.nameLabel': 'New group name',
  'groups.add': 'Add group',
  'groups.empty': 'No groups yet.',
  'groups.listLabel': 'Group list',
  'groups.online': '{count} online',
  'groups.offline': 'Offline',
  'groups.renameLabel': 'New name for {name}',
  'groups.save': 'Save',
  'groups.cancel': 'Cancel',
  'groups.rename': 'Rename',
  'groups.delete': 'Delete',
  'groups.deleteConfirm': 'Delete “{name}”?',
  'groups.renameAria': 'Rename {name}',
  'groups.deleteAria': 'Delete {name}',

  'control.title': 'Quiz control',
  'control.setCountdown': 'Set countdown',
  'control.countdownSeconds': 'Countdown (seconds)',
  'control.open': 'Start buzzing',
  'control.close': 'End buzzing',
  'control.fairness': 'Enable fair ranking',
  'control.fairnessHint':
    'Groups answering within 3 seconds count as one batch; within a batch, whoever has won fewer questions ranks higher.',
  'control.resetConfirmLabel': 'Confirm reset',
  'control.resetHint': 'Resetting returns to preparing; groups are kept',
  'control.resetConfirm': 'Confirm reset',
  'control.resetCancel': 'Cancel',
  'control.resetActivity': 'Reset activity',

  'import.sectionLabel': 'Import Guided Notes',
  'import.title': 'Import Guided Notes',
  'import.alternativesLabel': 'Other options',
  'import.alternativeShare': 'Change sharing to “anyone with the link”',
  'import.alternativeDownload': 'Download as xlsx and upload it',
  'import.formatHint': 'Use an xlsx file under 5 MB',
  'import.linkLabel': 'Google Sheets link',
  'import.read': 'Read',
  'import.fileLabel': 'Upload xlsx file',
  'import.summaryLabel': 'Import summary',
  'import.summaryTitle': 'Import summary',
  'import.sheet': 'Sheet: {name}',
  'import.counts': '{questions} questions, {blanks} blanks',
  'import.questionListLabel': 'Questions in the summary',
  'import.questionItem': 'Question {number} ({detail})',
  'import.prefix': 'Prefixes: {prefixes}',
  'import.noPrefix': '(no prefix)',
  'import.groupNotice': 'Question {numbers} is a group question',
  'import.warningsTitle': 'Warnings',
  'import.warningsLabel': 'Warnings',
  'import.warningNumbersNotSequential':
    'Question numbers do not start at 1 or are not continuous (actual: {numbers}) — please check before importing',
  'import.warningBlankHasContent':
    'Question {number} already has content in {cell}; it will be replaced on import',
  'import.warningMultipleSheets':
    'Several tabs have a header row; the “{name}” tab is being used',
  'import.replaceNotice': 'Confirming replaces the current questions',
  'import.confirm': 'Import',
  'import.cancel': 'Cancel',
  'import.kindSingle': 'Single',
  'import.kindGroup': 'Group',
  'import.kindDetail': '{kind}, {blanks} blanks',

  'list.sectionLabel': 'Question list',
  'list.title': 'Questions',
  'list.empty': 'No questions imported yet',
  'list.listLabel': 'Imported questions',

  'login.title': 'Teacher sign-in',
  'login.passwordLabel': 'Teacher password',
  'login.submitting': 'Signing in…',
  'login.submit': 'Sign in',

  'teacher.title': 'Teacher',
  'teacher.loginPending': 'Signed in — waiting for the teacher state.',
  'teacher.logout': 'Sign out',
  'teacher.passwordNotSet':
    'The server has no teacher password set yet. Set the TEACHER_PASSWORD environment variable and reload this page.',
  'teacher.exportTitle': 'Export',
  'teacher.writeBack': 'Write back to Google Sheets',
  'teacher.exportGuided': 'Export Guided Notes',
  'teacher.exportCsv': 'Export CSV',
  'teacher.noOnlineSheet':
    'This Guided Notes file was uploaded as xlsx, so there is no online sheet to write back to — use “Export Guided Notes”.',
  'teacher.projectorTitle': 'Projector',
  'teacher.openProjector': 'Open projector',
  'teacher.revealNext': 'Reveal next',
  'teacher.revealAll': 'Reveal all',
  'teacher.writeBackNone': 'No answers were submitted, so nothing was written back.',
  'teacher.writeBackRemapped':
    'The sheet layout moved, so the answers were matched to the new positions ({count} cells written).',
  'teacher.writeBackDone': 'Wrote {count} answers to the Google sheet.',
};

export const MESSAGES: Record<'zh-TW' | 'en', Messages> = {
  'zh-TW': zhTW,
  en,
};
