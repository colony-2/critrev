'use client';

import {useCallback, useMemo, useRef, useState} from 'react';
import {
  criticMarkupToReviewModel, finalizeReviewModel, listReviewChanges,
  resolveReviewModelChange, reviewModelToCriticMarkup,
  type ReviewChangeDecision, type ReviewComment, type ReviewModel,
} from '../review-model.js';
import {
  addReviewComment, beforeAfterToReviewModel, removeReviewComment,
  reviewModelForView, updateReviewComment,
} from '../review-operations.js';

export type UseReviewOptions = {
  /** Pass value and onChange to own state outside the hook. */
  value?: ReviewModel;
  /** Used only on mount. Use setValue or resetFromDiff to replace it later. */
  defaultValue?: ReviewModel;
  onChange?(value: ReviewModel): void;
};

export type ReviewController = ReturnType<typeof useReview>;

/** State and actions only: the application owns all controls and their presentation. */
export function useReview(options: UseReviewOptions = {}) {
  const [internalValue, setInternalValue] = useState(() => options.defaultValue ?? criticMarkupToReviewModel(''));
  const value = options.value ?? internalValue;
  const current = useRef({value, options});
  current.current = {value, options};

  const setValue = useCallback((next: ReviewModel | ((previous: ReviewModel) => ReviewModel)) => {
    const state = current.current;
    const resolved = typeof next === 'function' ? next(state.value) : next;
    // Keep sequential actions in one event cumulative. Callbacks run outside React updaters.
    state.value = resolved;
    if (state.options.value === undefined) setInternalValue(resolved);
    state.options.onChange?.(resolved);
  }, []);

  const actions = useMemo(() => ({
    setValue,
    resetFromDiff(before: string, after: string) {
      setValue(beforeAfterToReviewModel(before, after));
    },
    resolveChange(id: string, decision: ReviewChangeDecision) {
      setValue(model => {
        const index = model.suggestions.findIndex(suggestion => suggestion.id === id);
        if (index === -1) throw new RangeError(`No suggestion exists with id ${id}`);
        return resolveReviewModelChange(model, index, decision);
      });
    },
    resolveAll(decision: ReviewChangeDecision) {
      setValue(model => reviewModelForView(model, decision));
    },
    addComment(comment: Omit<ReviewComment, 'id'> & {readonly id?: string}) {
      setValue(model => addReviewComment(model, comment));
    },
    updateComment(id: string, text: string) {
      setValue(model => updateReviewComment(model, id, text));
    },
    removeComment(id: string) {
      setValue(model => removeReviewComment(model, id));
    },
  }), [setValue]);

  return {
    ...actions,
    value,
    changes: useMemo(() => listReviewChanges(value), [value]),
    comments: value.comments,
    criticMarkup: useMemo(() => reviewModelToCriticMarkup(value), [value]),
    finalize: (options?: Parameters<typeof finalizeReviewModel>[1]) => finalizeReviewModel(value, options),
  };
}
