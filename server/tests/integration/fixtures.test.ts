import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGuidedNotes } from '../../src/domain/guidedNotesParser.js';
import { validateImport } from '../../src/domain/importValidator.js';
import { readWorkbook } from '../../src/infra/xlsx/workbookReader.js';

type ExpectedBlank = { cell: string; prefix: string };
type ExpectedQuestion = { number: number; blanks: ExpectedBlank[] };
type ExpectedFixture = {
  file: string;
  valid: boolean;
  sheet?: string;
  questions?: ExpectedQuestion[];
  question_count?: number;
  blank_count?: number;
  error?: string;
};

const VALID_FIXTURES = [
  '01-official-single.xlsx',
  '02-official-group.xlsx',
  '03-shifted-layout.xlsx',
  '04-mixed-groups.xlsx',
  '05-two-sheets.xlsx',
] as const;

const INVALID_FIXTURES = [
  { file: '90-invalid-no-header.xlsx', code: 'HEADER_NOT_FOUND' },
  { file: '91-invalid-duplicate-number.xlsx', code: 'DUPLICATE_QUESTION_NUMBER' },
  { file: '92-invalid-empty.xlsx', code: 'NO_QUESTIONS' },
] as const;

function fixtureUrl(fileName: string): URL {
  return new URL(
    `../../../fixtures/guided-notes/${fileName}`,
    import.meta.url,
  );
}

async function readExpectedFixture(fileName: string): Promise<ExpectedFixture> {
  const text = await readFile(
    fileURLToPath(
      new URL('../../../fixtures/guided-notes/expected.json', import.meta.url),
    ),
    'utf8',
  );
  const expected: unknown = JSON.parse(text);
  if (!Array.isArray(expected)) {
    throw new TypeError('expected.json must contain an array');
  }

  const fixture = (expected as ExpectedFixture[]).find(
    (entry) => entry.file === fileName,
  );
  if (fixture === undefined) {
    throw new Error(`expected.json has no entry for ${fileName}`);
  }
  return fixture;
}

async function readFixtureGrids(fileName: string) {
  return readWorkbook(
    await readFile(fileURLToPath(fixtureUrl(fileName))),
  );
}

describe('Guided Notes fixtures', () => {
  for (const fileName of VALID_FIXTURES) {
    it(`${fileName} 逐項符合 expected.json`, async () => {
      const expected = await readExpectedFixture(fileName);
      expect(expected.valid).toBe(true);

      const parsed = parseGuidedNotes(await readFixtureGrids(fileName));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.message);
      }
      const result = validateImport(parsed);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.message);
      }

      const {
        sheet,
        questions: expectedQuestions,
        question_count: expectedQuestionCount,
        blank_count: expectedBlankCount,
      } = expected;
      if (
        sheet === undefined ||
        expectedQuestions === undefined ||
        expectedQuestionCount === undefined ||
        expectedBlankCount === undefined
      ) {
        throw new TypeError(`${fileName} must contain complete valid expectations`);
      }

      expect(result.sheetName).toBe(sheet);
      expect(result.questions).toHaveLength(expectedQuestionCount);
      expect(result.questions.flatMap((question) => question.blanks)).toHaveLength(
        expectedBlankCount,
      );
      expect(result.warnings).toEqual([]);
      expect(
        result.questions.map((question) => ({
          number: question.number,
          kind: question.kind,
          blankCount: question.blanks.length,
          blanks: question.blanks.map(({ cell, prefix }) => ({
            cell,
            prefix,
          })),
        })),
      ).toEqual(
        expectedQuestions.map((question) => ({
          number: question.number,
          kind: question.blanks.length === 1 ? 'single' : 'group',
          blankCount: question.blanks.length,
          blanks: question.blanks,
        })),
      );
    });
  }

  for (const { file: fileName, code } of INVALID_FIXTURES) {
    it(`${fileName} 回 ${code}`, async () => {
      const expected = await readExpectedFixture(fileName);
      expect(expected.valid).toBe(false);
      const parsed = parseGuidedNotes(await readFixtureGrids(fileName));

      if (code === 'DUPLICATE_QUESTION_NUMBER') {
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
          throw new Error(parsed.message);
        }
        const validated = validateImport(parsed);
        expect(validated.ok).toBe(false);
        if (validated.ok) {
          throw new Error('expected duplicate question number failure');
        }
        expect(validated.code).toBe(code);
        expect(validated.message).toContain('題號 3');
        expect(validated.message).toContain('第 9、11 列');
        return;
      }

      expect(parsed.ok).toBe(false);
      if (parsed.ok) {
        throw new Error(`expected ${code} failure`);
      }
      expect(parsed.code).toBe(code);
      if (code === 'HEADER_NOT_FOUND') {
        expect(parsed.message).toContain('「題號」');
        expect(parsed.message).toContain('「題目」');
        expect(parsed.message).toContain('「作答」');
      }
    });
  }
});
