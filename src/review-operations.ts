import {beforeAfterToCriticMarkup, type BeforeAfterToCriticMarkupOptions} from './critic-markup.js';
import {
  criticMarkupToReviewModel, insertReviewText, resolveReviewModelChange, withAddedSuggestion,
  type ReviewComment, type ReviewModel, type ReviewRange,
} from './review-model.js';

export type ReviewViewMode = 'revisions' | 'accept' | 'reject';

/** Build a review from two Markdown documents. */
export function beforeAfterToReviewModel(before: string, after: string, options?: BeforeAfterToCriticMarkupOptions): ReviewModel {
  return criticMarkupToReviewModel(beforeAfterToCriticMarkup(before, after, options));
}

/** Add a point (start === end) or range comment without mutating the model. */
export function addReviewComment(model: ReviewModel, comment: Omit<ReviewComment, 'id'> & {readonly id?: string}): ReviewModel {
  if (!Number.isInteger(comment.start) || !Number.isInteger(comment.end) ||
      comment.start < 0 || comment.end < comment.start || comment.end > model.text.length) {
    throw new RangeError('Comment range must be within the review text');
  }
  let id = comment.id;
  if (id === undefined) {
    let index = 1;
    while (model.comments.some(item => item.id === `comment-${index}`)) index += 1;
    id = `comment-${index}`;
  }
  if (model.comments.some(item => item.id === id)) {
    throw new Error(`A comment with id ${id} already exists`);
  }
  return {...model, comments: [...model.comments, {...comment, id}].sort((a, b) => a.start - b.start || a.end - b.end)};
}

export function updateReviewComment(model: ReviewModel, id: string, value: string): ReviewModel {
  if (!model.comments.some(comment => comment.id === id)) throw new RangeError(`No comment exists with id ${id}`);
  return {...model, comments: model.comments.map(comment => comment.id === id ? {...comment, value} : comment)};
}

export function removeReviewComment(model: ReviewModel, id: string): ReviewModel {
  return {...model, comments: model.comments.filter(comment => comment.id !== id)};
}

/** Apply one decision to every suggestion; also used for non-mutating previews. */
export function reviewModelForView(model: ReviewModel, viewMode: ReviewViewMode): ReviewModel {
  if (viewMode === 'revisions') {
    return model;
  }

  let nextModel = model;
  const decision = viewMode === 'accept' ? 'accept' : 'reject';
  for (let index = nextModel.suggestions.length - 1; index >= 0; index -= 1) {
    nextModel = resolveReviewModelChange(nextModel, index, decision);
  }
  return nextModel;
}

/** Turn an editor text update into a suggestion, preserving existing annotations. */
export function reconcileReviewEdit(baseline: ReviewModel, domModel: ReviewModel, selectionOffset?: number | null): ReviewModel {
  const diff = reviewTextDiff(baseline.text, domModel.text, selectionOffset);
  if (diff.oldValue === '' && diff.newValue === '') {
    return domModel;
  }

  const oldRange = {start: diff.start, end: diff.start + diff.oldValue.length};
  const newRange = {start: diff.start, end: diff.start + diff.newValue.length};
  if (
    rangeTouchesSuggestion(baseline, oldRange) ||
    rangeTouchesSuggestion(domModel, newRange)
  ) {
    return domModel;
  }

  if (diff.oldValue === '') {
    const expanded = insertReviewText(baseline, diff.start, diff.newValue);
    return withAddedSuggestion(expanded, {
      newRange,
      type: 'addition',
    });
  }

  if (diff.newValue === '') {
    return withAddedSuggestion(baseline, {
      oldRange,
      type: 'deletion',
    });
  }

  const expanded = insertReviewText(
    baseline,
    diff.start + diff.oldValue.length,
    diff.newValue,
  );
  return withAddedSuggestion(expanded, {
    newRange: {
      end: diff.start + diff.oldValue.length + diff.newValue.length,
      start: diff.start + diff.oldValue.length,
    },
    oldRange,
    type: 'substitution',
  });
}

export function reviewTextDiff(before: string, after: string, selectionOffset?: number | null): {newValue: string; oldValue: string; start: number} {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }

  // Repeated characters can make a text-only diff ambiguous. Anchor it at the
  // editor's caret so inserting "H" before "Hello" doesn't advance past the old H.
  if (selectionOffset !== undefined && selectionOffset !== null) {
    start = Math.min(start, Math.max(0, selectionOffset - Math.max(0, after.length - before.length)));
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    newValue: after.slice(start, afterEnd),
    oldValue: before.slice(start, beforeEnd),
    start,
  };
}

function rangeTouchesSuggestion(model: ReviewModel, range: ReviewRange): boolean {
  if (range.start === range.end) {
    return false;
  }
  return model.suggestions.some(suggestion =>
    rangesIntersect(range, suggestion.oldRange) || rangesIntersect(range, suggestion.newRange),
  );
}

function rangesIntersect(left: ReviewRange, right: ReviewRange | undefined): boolean {
  return right !== undefined && left.start < right.end && right.start < left.end;
}

export function selectionOffsetAfterSuggestion(diff: {
  readonly newValue: string;
  readonly oldValue: string;
  readonly start: number;
}): number | null {
  if (diff.oldValue === '' && diff.newValue === '') {
    return null;
  }
  if (diff.oldValue === '') {
    return diff.start + diff.newValue.length;
  }
  if (diff.newValue === '') {
    return diff.start;
  }
  return diff.start + diff.oldValue.length + diff.newValue.length;
}
