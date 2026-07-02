import {
  finalizeCriticMarkup,
  parseCriticMarkup,
  type FinalizeCriticMarkupOptions,
} from './critic-markup.js';

export type ReviewRange = {
  readonly end: number;
  readonly start: number;
};

export type ReviewSuggestionType = 'addition' | 'deletion' | 'substitution';

export type ReviewSuggestion = {
  readonly id: string;
  readonly newRange?: ReviewRange;
  readonly oldRange?: ReviewRange;
  readonly type: ReviewSuggestionType;
};

export type ReviewComment = {
  readonly end: number;
  readonly id: string;
  readonly start: number;
  readonly value: string;
};

export type ReviewHighlight = {
  readonly end: number;
  readonly id: string;
  readonly start: number;
};

export type ReviewModel = {
  readonly comments: readonly ReviewComment[];
  readonly highlights: readonly ReviewHighlight[];
  readonly suggestions: readonly ReviewSuggestion[];
  readonly text: string;
};

export type ReviewChange = {
  readonly changeIndex: number;
  readonly id: string;
  readonly newValue: string;
  readonly oldValue: string;
  readonly type: ReviewSuggestionType;
};

export type ReviewChangeDecision = 'accept' | 'reject';

type ReviewSuggestionDraft = {
  readonly id: string;
  readonly newRange?: ReviewRange | undefined;
  readonly oldRange?: ReviewRange | undefined;
  readonly type: ReviewSuggestionType;
};

let generatedId = 0;

export function criticMarkupToReviewModel(input: string): ReviewModel {
  const nodes = parseCriticMarkup(input);
  const suggestions: ReviewSuggestion[] = [];
  const comments: ReviewComment[] = [];
  const highlights: ReviewHighlight[] = [];
  let text = '';
  let suggestionIndex = 0;
  let annotationIndex = 0;

  const append = (value: string): ReviewRange => {
    const start = text.length;
    text += value;
    return {end: text.length, start};
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }

    switch (node.type) {
      case 'text':
        append(node.value);
        break;
      case 'addition':
        suggestions.push({
          id: `s${suggestionIndex++}`,
          newRange: append(node.value),
          type: 'addition',
        });
        break;
      case 'deletion':
        suggestions.push({
          id: `s${suggestionIndex++}`,
          oldRange: append(node.value),
          type: 'deletion',
        });
        break;
      case 'substitution': {
        const oldRange = append(node.oldValue);
        const newRange = append(node.newValue);
        suggestions.push({
          id: `s${suggestionIndex++}`,
          newRange,
          oldRange,
          type: 'substitution',
        });
        break;
      }
      case 'highlight': {
        const range = append(node.value);
        const nextNode = nodes[index + 1];
        if (nextNode?.type === 'comment') {
          comments.push({
            id: `c${annotationIndex++}`,
            ...range,
            value: nextNode.value,
          });
          index += 1;
        } else {
          highlights.push({id: `h${annotationIndex++}`, ...range});
        }
        break;
      }
      case 'comment':
        comments.push({
          end: text.length,
          id: `c${annotationIndex++}`,
          start: text.length,
          value: node.value,
        });
        break;
    }
  }

  return {comments, highlights, suggestions, text};
}

export function reviewModelToCriticMarkup(model: ReviewModel): string {
  const suggestions = model.suggestions
    .slice()
    .sort((left, right) => suggestionStart(left) - suggestionStart(right));
  const renderedPointCommentOffsets = new Set<number>();
  let cursor = 0;
  let output = '';

  output += renderPointCommentsAt(model, 0, renderedPointCommentOffsets);
  for (const suggestion of suggestions) {
    const start = suggestionStart(suggestion);
    const end = suggestionEnd(suggestion);
    if (start < cursor) {
      continue;
    }

    output += renderAnnotatedText(model, cursor, start);
    output += renderPointCommentsAt(model, start, renderedPointCommentOffsets);
    switch (suggestion.type) {
      case 'addition':
        if (suggestion.newRange !== undefined) {
          output += `{++${renderAnnotatedText(
            model,
            suggestion.newRange.start,
            suggestion.newRange.end,
          )}++}`;
        }
        break;
      case 'deletion':
        if (suggestion.oldRange !== undefined) {
          output += `{--${renderAnnotatedText(
            model,
            suggestion.oldRange.start,
            suggestion.oldRange.end,
          )}--}`;
        }
        break;
      case 'substitution':
        if (suggestion.oldRange !== undefined && suggestion.newRange !== undefined) {
          output += `{~~${renderAnnotatedText(
            model,
            suggestion.oldRange.start,
            suggestion.oldRange.end,
          )}~>${renderAnnotatedText(
            model,
            suggestion.newRange.start,
            suggestion.newRange.end,
          )}~~}`;
        }
        break;
    }
    cursor = Math.max(cursor, end);
    output += renderPointCommentsAt(model, cursor, renderedPointCommentOffsets);
  }

  output += renderAnnotatedText(model, cursor, model.text.length);
  output += renderPointCommentsAt(model, model.text.length, renderedPointCommentOffsets);
  return output;
}

export function finalizeReviewModel(
  model: ReviewModel,
  options: FinalizeCriticMarkupOptions = {},
): string {
  return finalizeCriticMarkup(reviewModelToCriticMarkup(model), options);
}

export function listReviewChanges(model: ReviewModel): ReviewChange[] {
  return model.suggestions.map((suggestion, changeIndex) => ({
    changeIndex,
    id: suggestion.id,
    newValue: suggestion.newRange === undefined ? '' : sliceRange(model.text, suggestion.newRange),
    oldValue: suggestion.oldRange === undefined ? '' : sliceRange(model.text, suggestion.oldRange),
    type: suggestion.type,
  }));
}

export function resolveReviewModelChange(
  model: ReviewModel,
  changeIndex: number,
  decision: ReviewChangeDecision,
): ReviewModel {
  const suggestion = model.suggestions[changeIndex];
  if (suggestion === undefined) {
    throw new RangeError(`No review suggestion exists at index ${changeIndex}`);
  }

  const withoutSuggestion: ReviewModel = {
    ...model,
    suggestions: model.suggestions.filter(item => item.id !== suggestion.id),
  };

  switch (suggestion.type) {
    case 'addition':
      return decision === 'accept' || suggestion.newRange === undefined
        ? withoutSuggestion
        : deleteReviewRange(withoutSuggestion, suggestion.newRange);
    case 'deletion':
      return decision === 'reject' || suggestion.oldRange === undefined
        ? withoutSuggestion
        : deleteReviewRange(withoutSuggestion, suggestion.oldRange);
    case 'substitution':
      if (suggestion.oldRange === undefined || suggestion.newRange === undefined) {
        return withoutSuggestion;
      }
      return decision === 'accept'
        ? deleteReviewRange(withoutSuggestion, suggestion.oldRange)
        : deleteReviewRange(withoutSuggestion, suggestion.newRange);
  }
}

export function createSuggestionId(): string {
  generatedId += 1;
  return `local-${generatedId}`;
}

export function withAddedSuggestion(
  model: ReviewModel,
  suggestion: Omit<ReviewSuggestion, 'id'> & {readonly id?: string},
): ReviewModel {
  return {
    ...model,
    suggestions: [
      ...model.suggestions,
      {
        ...suggestion,
        id: suggestion.id ?? createSuggestionId(),
      },
    ],
  };
}

export function insertReviewText(model: ReviewModel, offset: number, value: string): ReviewModel {
  return {
    comments: model.comments.map(comment => shiftAnnotationForInsert(comment, offset, value.length)),
    highlights: model.highlights.map(highlight =>
      shiftAnnotationForInsert(highlight, offset, value.length),
    ),
    suggestions: model.suggestions.map(suggestion =>
      shiftSuggestionForInsert(suggestion, offset, value.length),
    ),
    text: model.text.slice(0, offset) + value + model.text.slice(offset),
  };
}

export function deleteReviewRange(model: ReviewModel, range: ReviewRange): ReviewModel {
  const length = range.end - range.start;
  return {
    comments: model.comments
      .map(comment => shiftAnnotationForDelete(comment, range))
      .filter(comment => comment !== null),
    highlights: model.highlights
      .map(highlight => shiftAnnotationForDelete(highlight, range))
      .filter(highlight => highlight !== null),
    suggestions: model.suggestions
      .map(suggestion => shiftSuggestionForDelete(suggestion, range))
      .filter(suggestion => suggestion !== null),
    text: model.text.slice(0, range.start) + model.text.slice(range.end),
  };

  function shift(offset: number): number {
    if (offset <= range.start) {
      return offset;
    }
    if (offset >= range.end) {
      return offset - length;
    }
    return range.start;
  }

  function shiftAnnotationForDelete<T extends ReviewRange>(annotation: T, deleted: ReviewRange): T | null {
    if (annotation.end <= deleted.start || annotation.start >= deleted.end) {
      return {
        ...annotation,
        end: shift(annotation.end),
        start: shift(annotation.start),
      };
    }
    const next = {
      ...annotation,
      end: shift(annotation.end),
      start: shift(annotation.start),
    };
    return next.start === next.end && annotation.start !== annotation.end ? null : next;
  }

  function shiftSuggestionForDelete(suggestion: ReviewSuggestion, deleted: ReviewRange): ReviewSuggestion | null {
    const oldRange = suggestion.oldRange === undefined
      ? undefined
      : shiftAnnotationForDelete(suggestion.oldRange, deleted);
    const newRange = suggestion.newRange === undefined
      ? undefined
      : shiftAnnotationForDelete(suggestion.newRange, deleted);

    if (oldRange === null || newRange === null) {
      return null;
    }
    if (oldRange === undefined && newRange === undefined) {
      return null;
    }

    return withoutUndefinedRanges({...suggestion, newRange, oldRange});
  }
}

function renderAnnotatedText(model: ReviewModel, start: number, end: number): string {
  const annotations = [
    ...model.highlights
      .filter(highlight => containsRange(start, end, highlight) && highlight.start !== highlight.end)
      .map(highlight => ({...highlight, type: 'highlight' as const, value: ''})),
    ...model.comments
      .filter(comment => containsCommentRange(start, end, comment))
      .map(comment => ({...comment, type: 'comment' as const})),
  ].sort((left, right) => left.start - right.start || left.end - right.end);

  let cursor = start;
  let output = '';

  for (const annotation of annotations) {
    if (annotation.start < cursor) {
      continue;
    }

    output += escapeCriticMarkupText(model.text.slice(cursor, annotation.start));
    if (annotation.type === 'comment' && annotation.start === annotation.end) {
      output += `{>>${escapeCriticMarkupText(annotation.value)}<<}`;
      cursor = annotation.end;
      continue;
    }

    const rangeText = escapeCriticMarkupText(model.text.slice(annotation.start, annotation.end));
    output += `{==${rangeText}==}`;
    if (annotation.type === 'comment') {
      output += `{>>${escapeCriticMarkupText(annotation.value)}<<}`;
    }
    cursor = annotation.end;
  }

  output += escapeCriticMarkupText(model.text.slice(cursor, end));
  return output;
}

function renderPointCommentsAt(
  model: ReviewModel,
  offset: number,
  renderedOffsets: Set<number>,
): string {
  if (renderedOffsets.has(offset)) {
    return '';
  }
  renderedOffsets.add(offset);
  return model.comments
    .filter(comment => comment.start === offset && comment.end === offset)
    .map(comment => `{>>${escapeCriticMarkupText(comment.value)}<<}`)
    .join('');
}

function shiftAnnotationForInsert<T extends ReviewRange>(
  annotation: T,
  offset: number,
  length: number,
): T {
  return {
    ...annotation,
    end: annotation.end >= offset ? annotation.end + length : annotation.end,
    start: annotation.start >= offset ? annotation.start + length : annotation.start,
  };
}

function shiftSuggestionForInsert(
  suggestion: ReviewSuggestion,
  offset: number,
  length: number,
): ReviewSuggestion {
  return withoutUndefinedRanges({
    ...suggestion,
    newRange: suggestion.newRange === undefined
      ? undefined
      : shiftAnnotationForInsert(suggestion.newRange, offset, length),
    oldRange: suggestion.oldRange === undefined
      ? undefined
      : shiftAnnotationForInsert(suggestion.oldRange, offset, length),
  });
}

function withoutUndefinedRanges(suggestion: ReviewSuggestionDraft): ReviewSuggestion {
  const next: ReviewSuggestion = {
    id: suggestion.id,
    type: suggestion.type,
  };
  if (suggestion.newRange !== undefined) {
    return suggestion.oldRange === undefined
      ? {...next, newRange: suggestion.newRange}
      : {...next, newRange: suggestion.newRange, oldRange: suggestion.oldRange};
  }
  return suggestion.oldRange === undefined ? next : {...next, oldRange: suggestion.oldRange};
}

function containsRange(start: number, end: number, range: ReviewRange): boolean {
  return range.start >= start && range.end <= end;
}

function containsCommentRange(start: number, end: number, comment: ReviewComment): boolean {
  if (comment.start !== comment.end) {
    return containsRange(start, end, comment);
  }
  return comment.start > start && comment.start < end;
}

function suggestionStart(suggestion: ReviewSuggestion): number {
  const starts = [suggestion.oldRange?.start, suggestion.newRange?.start].filter(
    (value): value is number => value !== undefined,
  );
  return Math.min(...starts);
}

function suggestionEnd(suggestion: ReviewSuggestion): number {
  const ends = [suggestion.oldRange?.end, suggestion.newRange?.end].filter(
    (value): value is number => value !== undefined,
  );
  return Math.max(...ends);
}

function sliceRange(text: string, range: ReviewRange): string {
  return text.slice(range.start, range.end);
}

function escapeCriticMarkupText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replaceAll('{++', '\\{++')
    .replaceAll('++}', '\\++}')
    .replaceAll('{--', '\\{--')
    .replaceAll('--}', '\\--}')
    .replaceAll('{~~', '\\{~~')
    .replaceAll('~>', '\\~>')
    .replaceAll('~~}', '\\~~}')
    .replaceAll('{>>', '\\{>>')
    .replaceAll('<<', '\\<<')
    .replaceAll('{==', '\\{==')
    .replaceAll('==}', '\\==}');
}
