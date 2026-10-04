'use client';

import {Fragment, type ReactNode} from 'react';
import {listReviewChanges, type ReviewChange, type ReviewComment, type ReviewModel} from '../review-model.js';

export type ReviewChangesProps = {
  value: ReviewModel;
  renderChange(change: ReviewChange): ReactNode;
  renderComment?(comment: ReviewComment): ReactNode;
  empty?: ReactNode;
};

/** Render changes and comments in document order, with no imposed wrapper or controls. */
export function ReviewChanges({value, renderChange, renderComment, empty = null}: ReviewChangesProps) {
  const changes = listReviewChanges(value);
  const items = [
    ...changes.map(change => {
      const suggestion = value.suggestions[change.changeIndex]!;
      return {
        key: `suggestion:${change.id}`,
        start: Math.min(suggestion.oldRange?.start ?? Infinity, suggestion.newRange?.start ?? Infinity),
        render: () => renderChange(change),
      };
    }),
    ...(renderComment ? value.comments.map(comment => ({
      key: `comment:${comment.id}`, start: comment.start, render: () => renderComment(comment),
    })) : []),
  ].sort((a, b) => a.start - b.start);
  return <>{items.length === 0 ? empty : items.map(item => <Fragment key={item.key}>{item.render()}</Fragment>)}</>;
}
