import type {ReviewModel, ReviewRange} from './review-model.js';
const rangeEqual = (a: ReviewRange | undefined, b: ReviewRange | undefined) =>
  a === undefined || b === undefined ? a === b : a.start === b.start && a.end === b.end;
export function reviewModelsEqual(a: ReviewModel, b: ReviewModel): boolean {
  return a.text === b.text && a.suggestions.length === b.suggestions.length &&
    a.comments.length === b.comments.length && a.highlights.length === b.highlights.length &&
    a.suggestions.every((x, i) => {
      const y = b.suggestions[i]!;
      return x.id === y.id && x.type === y.type && rangeEqual(x.oldRange, y.oldRange) && rangeEqual(x.newRange, y.newRange);
    }) && a.comments.every((x, i) => {
      const y = b.comments[i]!;
      return x.id === y.id && x.value === y.value && rangeEqual(x, y);
    }) && a.highlights.every((x, i) => {
      const y = b.highlights[i]!;
      return x.id === y.id && rangeEqual(x, y);
    });
}
export function copyReviewModel(model: ReviewModel): ReviewModel {
  return {
    text: model.text,
    comments: model.comments.map(x => ({...x})), highlights: model.highlights.map(x => ({...x})),
    suggestions: model.suggestions.map(x => ({id: x.id, type: x.type,
      ...(x.oldRange === undefined ? {} : {oldRange: {...x.oldRange}}),
      ...(x.newRange === undefined ? {} : {newRange: {...x.newRange}}),
    })),
  };
}
