'use client';

import {
  forwardRef, useEffect, useImperativeHandle, useReducer, useRef,
  type HTMLAttributes, type MouseEvent,
} from 'react';
import {
  createReviewLexicalAdapter,
  type ReviewContentMode, type ReviewLexicalAdapter, type ReviewLexicalAdapterOptions,
  type ReviewMarkdownFormatCommand,
} from '../lexical/index.js';
import type {ReviewModel, ReviewRange} from '../review-model.js';
import {
  reconcileReviewEdit, reviewModelForView, reviewTextDiff, selectionOffsetAfterSuggestion,
  type ReviewViewMode,
} from '../review-operations.js';

export type ReviewEditorHandle = {
  focus(): void;
  /** Returns source offsets in value. Null outside the editor or in preview modes. */
  getSelectionRange(): ReviewRange | null;
  applyMarkdownFormat(command: Omit<ReviewMarkdownFormatCommand, 'mode'>): void;
};

export type ReviewEditorProps = Omit<HTMLAttributes<HTMLDivElement>,
  'children' | 'dangerouslySetInnerHTML' | 'onChange' | 'contentEditable' | 'defaultValue'
> & Pick<ReviewLexicalAdapterOptions, 'namespace' | 'theme' | 'classNames' | 'renderCommentAnchor' | 'onError'> & {
  value: ReviewModel;
  onChange?(value: ReviewModel): void;
  contentMode?: ReviewContentMode;
  viewMode?: ReviewViewMode;
  readOnly?: boolean;
  /** Edits create suggestions by default; false applies edits directly. */
  trackChanges?: boolean;
  /** Called on context menu / Shift+F10. Render your own comment composer. */
  onCommentRequest?(range: ReviewRange, event: MouseEvent<HTMLDivElement>): void;
};

/** An unstyled contenteditable surface. Toolbars, comment UI and layout belong to the app. */
export const ReviewEditor = forwardRef<ReviewEditorHandle, ReviewEditorProps>(function ReviewEditor({
  value, onChange, contentMode = 'wysiwyg', viewMode = 'revisions', readOnly = false,
  trackChanges = true, namespace, theme, classNames, renderCommentAnchor, onError,
  onCommentRequest, onContextMenu, ...domProps
}, forwardedRef) {
  const root = useRef<HTMLDivElement>(null);
  const adapter = useRef<ReviewLexicalAdapter | null>(null);
  const rendered = useRef<{value: ReviewModel; contentMode: ReviewContentMode; viewMode: ReviewViewMode} | null>(null);
  const latest = useRef({value, onChange, contentMode, viewMode, readOnly, trackChanges, onError});
  latest.current = {value, onChange, contentMode, viewMode, readOnly, trackChanges, onError};
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const editable = !readOnly && viewMode === 'revisions' && onChange !== undefined;

  useImperativeHandle(forwardedRef, () => ({
    focus: () => adapter.current?.focus(),
    getSelectionRange: () => latest.current.viewMode === 'revisions'
      ? adapter.current?.readModelSelectionRange() ?? null : null,
    applyMarkdownFormat(command) {
      const state = latest.current;
      if (!state.readOnly && state.viewMode === 'revisions' && state.onChange) {
        adapter.current?.applyMarkdownFormat({...command, mode: state.contentMode});
      }
    },
  }), []);

  useEffect(() => {
    if (!root.current) return;
    const instance = createReviewLexicalAdapter(root.current, {
      ...(namespace === undefined ? {} : {namespace}),
      ...(theme === undefined ? {} : {theme}),
      ...(classNames === undefined ? {} : {classNames}),
      ...(renderCommentAnchor === undefined ? {} : {renderCommentAnchor}),
      onError(error) {
        if (latest.current.onError) latest.current.onError(error);
        else throw error;
      },
      onChange(domModel, selectionOffset) {
        const state = latest.current;
        if (state.readOnly || state.viewMode !== 'revisions' || !state.onChange) return;
        const baseline = rendered.current?.value ?? state.value;
        const next = state.trackChanges ? reconcileReviewEdit(baseline, domModel, selectionOffset) : domModel;
        rendered.current = {value: next, contentMode: state.contentMode, viewMode: state.viewMode};
        if (next !== domModel) {
          instance.setModel(next, state.contentMode);
          instance.restoreModelSelectionOffset(selectionOffsetAfterSuggestion(reviewTextDiff(baseline.text, domModel.text, selectionOffset)));
        }
        state.onChange(next);
        // A controlled owner may decline the edit, so always reconcile with props.
        refresh();
      },
    });
    adapter.current = instance;
    rendered.current = null;
    return () => {
      instance.dispose();
      adapter.current = null;
      rendered.current = null;
    };
  }, [namespace, theme, classNames, renderCommentAnchor]);

  useEffect(() => {
    const instance = adapter.current;
    if (!instance) return;
    const previous = rendered.current;
    if (!previous || previous.value !== value || previous.contentMode !== contentMode || previous.viewMode !== viewMode) {
      instance.setModel(reviewModelForView(value, viewMode), contentMode);
      rendered.current = {value, contentMode, viewMode};
    }
    instance.setEditable(editable);
  });

  return <div
    role="textbox"
    aria-label="Review editor"
    aria-multiline="true"
    tabIndex={0}
    {...domProps}
    ref={root}
    aria-readonly={!editable}
    data-critrev-editor=""
    data-content-mode={contentMode}
    data-view-mode={viewMode}
    suppressContentEditableWarning
    onContextMenu={event => {
      onContextMenu?.(event);
      if (event.defaultPrevented || !onCommentRequest || readOnly || viewMode !== 'revisions') return;
      const range = adapter.current?.readModelSelectionRange();
      if (range) {
        event.preventDefault();
        onCommentRequest(range, event);
      }
    }}
  />;
});
