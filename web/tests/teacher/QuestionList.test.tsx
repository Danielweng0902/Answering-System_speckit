import { cleanup, render, screen } from '@testing-library/react';
import type { QuestionSummary } from '@classroom/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { QuestionList } from '../../src/features/teacher/QuestionList';

const questions: QuestionSummary[] = [
  { number: 1, kind: 'group', prompt: '題組敘述', blankCount: 2 },
  { number: 3, kind: 'single', prompt: '單題敘述', blankCount: 1 },
];

describe('QuestionList', () => {
  afterEach(() => {
    cleanup();
  });

  it('標示每題是單題或題組與空格數，並保留題目敘述', () => {
    render(<QuestionList questions={questions} />);

    const list = screen.getByRole('region', { name: '題目清單' });
    const text = list.textContent ?? '';

    expect(text).toContain('第 1 題');
    expect(text).toContain('題組，2 個空格');
    expect(text).toContain('題組敘述');
    expect(text).toContain('第 3 題');
    expect(text).toContain('單題，1 個空格');
    expect(text).toContain('單題敘述');
  });

  it('沒有題目時顯示「尚未匯入題目」', () => {
    render(<QuestionList questions={[]} />);

    expect(screen.getByText('尚未匯入題目')).toBeDefined();
    expect(screen.queryByRole('list', { name: '已匯入題目' })).toBeNull();
  });
});
