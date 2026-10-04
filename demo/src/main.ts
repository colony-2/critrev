import './styles.css';

import {
  beforeAfterToCriticMarkup,
  reconcileReviewEdit as reconcileRenderedEdit,
  reviewModelForView as modelForView,
  criticMarkupToReviewModel,
  finalizeReviewModel,
  listReviewChanges,
  resolveReviewModelChange,
  reviewModelToCriticMarkup,
  type ReviewChange,
  type ReviewChangeDecision,
  type ReviewComment,
  type ReviewModel,
  type ReviewRange,
} from '../../src/index';
import {
  createReviewLexicalAdapter,
  type ReviewContentMode,
  type ReviewLexicalAdapter,
  type ReviewMarkdownFormatAction,
  type ReviewMarkdownFormatCommand,
  type ReviewRichBlockFormat,
} from '../../src/lexical/index.js';

type ViewMode = 'accept' | 'reject' | 'revisions';
type ChangeListItem =
  | {
      readonly change: ReviewChange;
      readonly kind: 'change';
      readonly sortEnd: number;
      readonly sortStart: number;
    }
  | {
      readonly comment: ReviewComment;
      readonly kind: 'comment';
      readonly sortEnd: number;
      readonly sortStart: number;
    };

const sampleBefore = 'this is **a great idea** for us.\n\nPlease ship the first draft.';
const sampleAfter = 'this **great** for us\n\nPlease ship the polished draft.';
const sampleRangeComment = 'Range comment: tighten the action wording';
const samplePointComment = 'Point comment: confirm the delivery owner';
const hoverRevealDelayMs = 450;
const hoverDismissDelayMs = 280;

const beforeInput = getElement<HTMLTextAreaElement>('before-input');
const afterInput = getElement<HTMLTextAreaElement>('after-input');
const editorInput = getElement<HTMLTextAreaElement>('critic-input');
const editorOutput = getElement<HTMLTextAreaElement>('critic-output');
const finalOutput = getElement<HTMLTextAreaElement>('final-output');
const cleanOutput = getElement<HTMLTextAreaElement>('clean-output');
const renderedReview = getElement<HTMLElement>('rendered-review');
const metrics = getElement<HTMLElement>('metrics');
const changeList = getElement<HTMLElement>('change-list');
const inlineReviewActions = getElement<HTMLElement>('inline-review-actions');
const commentPopover = getElement<HTMLFormElement>('comment-popover');
const commentInput = getElement<HTMLInputElement>('comment-input');
const commentDisplay = getElement<HTMLElement>('comment-display');
const commentDisplayText = getElement<HTMLElement>('comment-display-text');
const commentDeleteButton = getElement<HTMLButtonElement>('comment-delete');
const infoPopover = getElement<HTMLElement>('info-popover');
const infoToggle = getElement<HTMLButtonElement>('info-toggle');
const statusPill = getElement<HTMLElement>('status-pill');
const viewModeMenu = getElement<HTMLElement>('view-mode-menu');
const viewModeToggle = getElement<HTMLButtonElement>('view-mode-toggle');
const commentsToggle = getElement<HTMLInputElement>('comments-toggle');
const viewModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-view-mode]'),
);
const formatButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-format-prefix]'),
);
const contentModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-content-mode]'),
);
let activeViewMode: ViewMode = 'revisions';
let activeContentMode: ReviewContentMode = 'wysiwyg';
let activeChangeIndex: number | null = null;
let activeCommentId: string | null = null;
let commentsVisible = true;
let editorModel: ReviewModel = emptyReviewModel();
let editBaselineModel: ReviewModel = emptyReviewModel();
let longTouchTimer = 0;
let hoverRevealTimer = 0;
let hoverDismissTimer = 0;
let pendingHoverTarget: HTMLElement | null = null;
let activeHoverTarget: HTMLElement | null = null;
let pendingCommentRange: ReviewRange | null = null;
const reviewEditor: ReviewLexicalAdapter = createReviewLexicalAdapter(renderedReview, {
  onChange: applyLexicalEditAsSuggestion,
});

beforeInput.value = sampleBefore;
afterInput.value = sampleAfter;

getElement<HTMLButtonElement>('reset-sample').addEventListener('click', () => {
  beforeInput.value = sampleBefore;
  afterInput.value = sampleAfter;
  initializeEditor(sampleEditorInput());
});

getElement<HTMLButtonElement>('sync-review').addEventListener('click', syncCriticMarkup);
getElement<HTMLButtonElement>('load-editor').addEventListener('click', loadEditorInput);
viewModeToggle.addEventListener('click', () => {
  toggleToolbarPopover(viewModeMenu, viewModeToggle);
  hideToolbarPopover(infoPopover, infoToggle);
});
infoToggle.addEventListener('click', () => {
  toggleToolbarPopover(infoPopover, infoToggle);
  hideToolbarPopover(viewModeMenu, viewModeToggle);
});
document.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  if (target.closest('.toolbar-menu') === null) {
    hideToolbarPopover(viewModeMenu, viewModeToggle);
    hideToolbarPopover(infoPopover, infoToggle);
  }
  if (target.closest('[data-comment-value]') === null && target.closest('#comment-display') === null) {
    hideCommentDisplay();
  }
});

beforeInput.addEventListener('input', updateGeneratedOnly);
afterInput.addEventListener('input', updateGeneratedOnly);
editorInput.addEventListener('input', () => {
  statusPill.textContent = 'Input edited';
});
for (const button of formatButtons) {
  button.addEventListener('mousedown', event => {
    event.preventDefault();
  });
  button.addEventListener('click', () => {
    applyMarkdownFormat(button);
  });
}
for (const button of contentModeButtons) {
  button.addEventListener('click', () => {
    activeContentMode = button.dataset.contentMode as ReviewContentMode;
    syncContentModeButtons();
    renderEditorOutput();
  });
}
changeList.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const deleteCommentButton = target.closest<HTMLButtonElement>(
    'button[data-comment-id][data-comment-action="delete"]',
  );
  if (deleteCommentButton !== null) {
    deleteComment(deleteCommentButton.dataset.commentId ?? '');
    return;
  }

  const button = target.closest<HTMLButtonElement>(
    'button[data-change-index][data-decision]',
  );
  if (button === null) {
    const commentCard = target.closest<HTMLElement>('[data-comment-card-id]');
    if (commentCard !== null) {
      setActiveCommentId(commentCard.dataset.commentCardId ?? null);
      return;
    }

    const card = target.closest<HTMLElement>('[data-suggestion-index]');
    if (card !== null) {
      setActiveChangeIndex(Number(card.dataset.suggestionIndex));
    }
    return;
  }

  const changeIndex = Number(button.dataset.changeIndex);
  const decision = button.dataset.decision as ReviewChangeDecision;
  resolveChange(changeIndex, decision);
});
changeList.addEventListener('focusin', event => {
  const target = event.target as HTMLElement;
  const commentCard = target.closest<HTMLElement>('[data-comment-card-id]');
  if (commentCard !== null) {
    setActiveCommentId(commentCard.dataset.commentCardId ?? null);
    return;
  }

  const card = target.closest<HTMLElement>('[data-suggestion-index]');
  if (card !== null) {
    setActiveChangeIndex(Number(card.dataset.suggestionIndex));
  }
});
document.addEventListener('pointermove', handleReviewHoverMove);
renderedReview.addEventListener('pointerleave', scheduleHoverDismiss);
inlineReviewActions.addEventListener('pointerenter', cancelHoverDismiss);
inlineReviewActions.addEventListener('pointerleave', scheduleHoverDismiss);
commentDisplay.addEventListener('pointerenter', cancelHoverDismiss);
commentDisplay.addEventListener('pointerleave', scheduleHoverDismiss);
commentDeleteButton.addEventListener('click', () => {
  if (activeCommentId !== null) {
    deleteComment(activeCommentId);
  }
});
renderedReview.addEventListener('keyup', () => {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const changeElement = element?.closest<HTMLElement>('[data-change-index]');
  if (changeElement === undefined || changeElement === null) {
    hideInlineActions();
    setActiveChangeIndex(null);
    return;
  }
  showInlineActions(changeElement);
});
renderedReview.addEventListener('contextmenu', event => {
  const selection = window.getSelection();
  if (selectionWithinRenderedReview(selection)) {
    event.preventDefault();
    showCommentPopover(event.clientX, event.clientY);
  }
});
renderedReview.addEventListener('pointerdown', event => {
  window.clearTimeout(longTouchTimer);
  if (event.pointerType !== 'touch') {
    return;
  }

  longTouchTimer = window.setTimeout(() => {
    const selection = window.getSelection();
    if (selectionWithinRenderedReview(selection)) {
      showCommentPopover(event.clientX, event.clientY);
    }
  }, 650);
});
renderedReview.addEventListener('pointercancel', clearLongTouchTimer);
renderedReview.addEventListener('pointerup', clearLongTouchTimer);
inlineReviewActions.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-inline-decision]',
  );
  if (button === null) {
    return;
  }

  const changeIndex = Number(inlineReviewActions.dataset.changeIndex);
  const decision = button.dataset.inlineDecision as ReviewChangeDecision;
  resolveChange(changeIndex, decision);
});
commentPopover.addEventListener('submit', event => {
  event.preventDefault();
  addCommentFromSelection();
});
for (const button of viewModeButtons) {
  button.addEventListener('click', () => {
    activeViewMode = button.dataset.viewMode as ViewMode;
    for (const nextButton of viewModeButtons) {
      nextButton.classList.toggle('active', nextButton === button);
    }
    hideInlineActions();
    hideCommentPopover();
    hideCommentDisplay();
    hideToolbarPopover(viewModeMenu, viewModeToggle);
    renderEditorOutput();
  });
}
commentsToggle.addEventListener('change', () => {
  commentsVisible = commentsToggle.checked;
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
});

initializeEditor(sampleEditorInput());

function syncCriticMarkup(): void {
  initializeEditor(buildEditorInputFromBeforeAfter());
}

function buildEditorInputFromBeforeAfter(): string {
  return beforeAfterToCriticMarkup(beforeInput.value, afterInput.value);
}

function sampleEditorInput(): string {
  return [
    'this {~~is **a great idea** for us.~>**great** for us~~}',
    '',
    `{==Please ship==}{>>${sampleRangeComment}<<} the {~~first draft.~>polished draft.~~}{>>${samplePointComment}<<}`,
  ].join('\n');
}

function initializeEditor(criticMarkup: string): void {
  editorInput.value = criticMarkup;
  editorModel = criticMarkupToReviewModel(criticMarkup);
  activeChangeIndex = null;
  activeCommentId = null;
  editBaselineModel = cloneReviewModel(editorModel);
  activeViewMode = 'revisions';
  activeContentMode = 'wysiwyg';
  commentsVisible = true;
  for (const button of viewModeButtons) {
    button.classList.toggle('active', button.dataset.viewMode === activeViewMode);
  }
  commentsToggle.checked = commentsVisible;
  syncContentModeButtons();
  renderEditorOutput();
}

function loadEditorInput(): void {
  editorModel = criticMarkupToReviewModel(editorInput.value);
  activeChangeIndex = null;
  activeCommentId = null;
  editBaselineModel = cloneReviewModel(editorModel);
  renderEditorOutput();
}

function updateGeneratedOnly(): void {
  const generated = buildEditorInputFromBeforeAfter();
  statusPill.textContent = generated === editorInput.value ? 'Input synced' : 'Input stale';
}

function renderEditorOutput(): void {
  const visibleModel = modelForEditorDisplay(editorModel, activeViewMode);
  reviewEditor.setModel(visibleModel, activeContentMode);
  reviewEditor.setEditable(activeViewMode === 'revisions');
  syncFormatToolbarState();
  refreshDerivedPanels();
}

function syncContentModeButtons(): void {
  for (const button of contentModeButtons) {
    button.classList.toggle('active', button.dataset.contentMode === activeContentMode);
  }
}

function syncFormatToolbarState(): void {
  const disabled = activeViewMode !== 'revisions';
  for (const button of formatButtons) {
    button.disabled = disabled;
  }
}

function rerenderEditorAtSelectionOffset(selectionOffset: number | null): void {
  renderEditorOutput();
  reviewEditor.restoreSelectionOffset(selectionOffset);
}

function refreshDerivedPanels(): void {
  editorOutput.value = reviewModelToCriticMarkup(editorModel);
  finalOutput.value = finalizeReviewModel(editorModel);
  cleanOutput.value = finalizeReviewModel(editorModel, {preserveComments: false});
  metrics.innerHTML = renderMetrics(editorModel);
  changeList.innerHTML = renderChangeList(editorModel, listReviewChanges(editorModel));
  syncActiveReviewState();
  statusPill.textContent =
    editorOutput.value === editorInput.value
      ? 'Loaded'
      : 'Edited';
}

function resolveChange(
  changeIndex: number,
  decision: ReviewChangeDecision,
): void {
  editorModel = resolveReviewModelChange(editorModel, changeIndex, decision);
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideInlineActions();
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
}

function renderChangeList(model: ReviewModel, changes: readonly ReviewChange[]): string {
  const items = buildChangeListItems(model, changes);
  if (items.length === 0) {
    return '<p class="empty">No pending changes or comments</p>';
  }

  return items
    .map(item => (item.kind === 'change' ? renderChangeCard(item.change) : renderCommentCard(model, item.comment)))
    .join('');
}

function buildChangeListItems(
  model: ReviewModel,
  changes: readonly ReviewChange[],
): ChangeListItem[] {
  return [
    ...changes.map(change => {
      const suggestion = model.suggestions[change.changeIndex];
      const range = suggestion === undefined
        ? {end: change.changeIndex, start: change.changeIndex}
        : suggestionRange(suggestion);
      return {
        change,
        kind: 'change' as const,
        sortEnd: range.end,
        sortStart: range.start,
      };
    }),
    ...model.comments.map(comment => ({
      comment,
      kind: 'comment' as const,
      sortEnd: comment.end,
      sortStart: comment.start,
    })),
  ].sort(compareChangeListItems);
}

function compareChangeListItems(left: ChangeListItem, right: ChangeListItem): number {
  return (
    left.sortStart - right.sortStart ||
    left.sortEnd - right.sortEnd ||
    itemSortRank(left) - itemSortRank(right)
  );
}

function itemSortRank(item: ChangeListItem): number {
  return item.kind === 'change' ? 0 : 1;
}

function renderChangeCard(change: ReviewChange): string {
  const activeClass = change.changeIndex === activeChangeIndex ? ' active' : '';
  return `<section class="change-card${activeClass}" data-suggestion-index="${change.changeIndex}" data-testid="suggestion-card" tabindex="0">
    <div>
      <p class="change-type">${change.type}</p>
      <p class="change-description">${describeChange(change)}</p>
    </div>
    <div class="change-actions">
      <button type="button" data-testid="accept-change" data-change-index="${change.changeIndex}" data-decision="accept">Accept</button>
      <button type="button" data-testid="reject-change" data-change-index="${change.changeIndex}" data-decision="reject">Reject</button>
    </div>
  </section>`;
}

function renderCommentCard(model: ReviewModel, comment: ReviewComment): string {
  const activeClass = comment.id === activeCommentId ? ' active' : '';
  return `<section class="change-card comment-card${activeClass}" data-comment-card-id="${escapeHtml(comment.id)}" data-testid="comment-card" tabindex="0">
    <div>
      <p class="change-type">comment</p>
      <p class="change-description">${describeComment(model, comment)}</p>
    </div>
    <div class="change-actions">
      <button type="button" data-testid="delete-comment-card" data-comment-id="${escapeHtml(comment.id)}" data-comment-action="delete">Delete</button>
    </div>
  </section>`;
}

function applyMarkdownFormat(button: HTMLButtonElement): void {
  if (activeViewMode !== 'revisions') {
    return;
  }

  const prefix = decodeToolbarValue(button.dataset.formatPrefix ?? '');
  const suffix = decodeToolbarValue(button.dataset.formatSuffix ?? prefix);
  if (prefix.length === 0 && suffix.length === 0) {
    return;
  }

  const placeholder = button.dataset.formatPlaceholder;
  const richBlock = button.dataset.richBlock as ReviewRichBlockFormat | undefined;
  const richFormat = button.dataset.richFormat as ReviewMarkdownFormatCommand['richFormat'];
  const command: ReviewMarkdownFormatCommand = {
    action: (button.dataset.formatAction ?? 'inline') as ReviewMarkdownFormatAction,
    mode: activeContentMode,
    prefix,
    suffix,
    ...(placeholder === undefined ? {} : {placeholder}),
    ...(richBlock === undefined ? {} : {richBlock}),
    ...(richFormat === undefined ? {} : {richFormat}),
  };
  reviewEditor.applyMarkdownFormat(command);
  statusPill.textContent = 'Formatting suggested';
}

function decodeToolbarValue(value: string): string {
  return value.replaceAll('\\n', '\n');
}

function describeChange(change: ReviewChange): string {
  switch (change.type) {
    case 'addition':
      return `<q>${markdownInlineToHtml(change.newValue)}</q> added`;
    case 'deletion':
      return `<q>${markdownInlineToHtml(change.oldValue)}</q> deleted`;
    case 'substitution':
      return `<q>${markdownInlineToHtml(change.oldValue)}</q> changed to <q>${markdownInlineToHtml(change.newValue)}</q>`;
  }
  return '';
}

function describeComment(model: ReviewModel, comment: ReviewComment): string {
  const value = escapeHtml(comment.value);
  if (comment.start === comment.end) {
    return `Point comment: ${value}`;
  }

  const context = markdownInlineToHtml(model.text.slice(comment.start, comment.end));
  return `Comment on <q>${context}</q>: ${value}`;
}

function handleReviewHoverMove(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    scheduleHoverDismiss();
    return;
  }

  if (target.closest('#inline-review-actions, #comment-display') !== null) {
    cancelHoverDismiss();
    return;
  }

  if (!renderedReview.contains(target)) {
    scheduleHoverDismiss();
    return;
  }

  const hoverTarget = reviewHoverTarget(target);
  if (hoverTarget === null) {
    scheduleHoverDismiss();
    return;
  }

  scheduleHoverReveal(hoverTarget);
}

function reviewHoverTarget(target: Element): HTMLElement | null {
  const changeTarget = target.closest<HTMLElement>('[data-change-index]');
  if (changeTarget !== null && renderedReview.contains(changeTarget)) {
    return changeTarget;
  }

  if (!commentsVisible) {
    return null;
  }

  const commentTarget = target.closest<HTMLElement>('[data-comment-value]');
  if (commentTarget !== null && renderedReview.contains(commentTarget)) {
    return commentTarget;
  }

  return null;
}

function scheduleHoverReveal(target: HTMLElement): void {
  cancelHoverDismiss();
  if (activeHoverTarget === target) {
    return;
  }
  if (pendingHoverTarget === target) {
    return;
  }

  window.clearTimeout(hoverRevealTimer);
  pendingHoverTarget = target;
  hoverRevealTimer = window.setTimeout(() => {
    const nextTarget = pendingHoverTarget;
    pendingHoverTarget = null;
    if (nextTarget !== null && nextTarget.isConnected) {
      showHoverOverlay(nextTarget);
    }
  }, hoverRevealDelayMs);
}

function showHoverOverlay(target: HTMLElement): void {
  activeHoverTarget = target;
  if (target.dataset.changeIndex !== undefined) {
    showInlineActions(target);
    return;
  }

  showCommentDisplay(target);
}

function scheduleHoverDismiss(): void {
  window.clearTimeout(hoverRevealTimer);
  pendingHoverTarget = null;
  window.clearTimeout(hoverDismissTimer);
  hoverDismissTimer = window.setTimeout(() => {
    activeHoverTarget = null;
    hideInlineActions();
    hideCommentDisplay();
    setActiveChangeIndex(null);
  }, hoverDismissDelayMs);
}

function cancelHoverDismiss(): void {
  window.clearTimeout(hoverDismissTimer);
}

function showInlineActions(changeElement: HTMLElement): void {
  const changeIndex = Number(changeElement.dataset.changeIndex);
  inlineReviewActions.dataset.changeIndex = String(changeIndex);
  inlineReviewActions.hidden = false;
  setActiveChangeIndex(changeIndex);
  hideCommentPopover();
  hideCommentDisplay();

  const changeRect = changeElement.getBoundingClientRect();
  const panel = renderedReview.closest<HTMLElement>('.editor-surface');
  const panelRect = panel?.getBoundingClientRect() ?? renderedReview.getBoundingClientRect();
  const left = Math.max(8, Math.min(changeRect.left - panelRect.left, panelRect.width - 88));
  const top = Math.max(8, changeRect.top - panelRect.top - 38);
  inlineReviewActions.style.left = `${left}px`;
  inlineReviewActions.style.top = `${top}px`;
}

function hideInlineActions(): void {
  inlineReviewActions.hidden = true;
  inlineReviewActions.removeAttribute('data-change-index');
}

function setActiveChangeIndex(changeIndex: number | null): void {
  activeChangeIndex = changeIndex === null || !Number.isFinite(changeIndex) ? null : changeIndex;
  if (activeChangeIndex !== null) {
    activeCommentId = null;
  }
  syncActiveReviewState();
}

function setActiveCommentId(commentId: string | null): void {
  activeCommentId = commentId;
  if (activeCommentId !== null) {
    activeChangeIndex = null;
  }
  syncActiveReviewState();
}

function syncActiveReviewState(): void {
  for (const card of changeList.querySelectorAll<HTMLElement>('[data-suggestion-index]')) {
    card.classList.toggle(
      'active',
      Number(card.dataset.suggestionIndex) === activeChangeIndex,
    );
  }

  for (const change of renderedReview.querySelectorAll<HTMLElement>('[data-change-index]')) {
    change.classList.toggle(
      'active-review-change',
      Number(change.dataset.changeIndex) === activeChangeIndex,
    );
  }

  for (const card of changeList.querySelectorAll<HTMLElement>('[data-comment-card-id]')) {
    card.classList.toggle('active', card.dataset.commentCardId === activeCommentId);
  }

  for (const comment of renderedReview.querySelectorAll<HTMLElement>('[data-comment-id]')) {
    comment.classList.toggle('active-review-comment', comment.dataset.commentId === activeCommentId);
  }
}

function applyLexicalEditAsSuggestion(
  domModel: ReviewModel,
  selectionOffset: number | null,
): void {
  if (activeViewMode !== 'revisions') {
    renderEditorOutput();
    return;
  }

  const diff = textDiff(editBaselineModel.text, domModel.text);
  const nextModel = reconcileRenderedEdit(editBaselineModel, domModel);
  const shouldRerenderEditor = nextModel !== domModel;
  editorModel = nextModel;
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideInlineActions();
  hideCommentPopover();
  hideCommentDisplay();
  if (shouldRerenderEditor) {
    rerenderEditorAtSelectionOffset(selectionOffsetAfterSuggestion(diff));
    statusPill.textContent = 'Suggestion added';
  } else {
    refreshDerivedPanels();
    statusPill.textContent = 'Suggestion updated';
  }
}

function selectionOffsetAfterSuggestion(diff: {
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

function showCommentPopover(clientX: number, clientY: number): void {
  hideInlineActions();
  hideCommentDisplay();
  const selection = window.getSelection();
  pendingCommentRange = selectionWithinRenderedReview(selection)
    ? reviewEditor.readSelectionRange()
    : null;

  const panel = renderedReview.closest<HTMLElement>('.editor-surface');
  const panelRect = panel?.getBoundingClientRect() ?? renderedReview.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX - panelRect.left, panelRect.width - 260));
  const top = Math.max(8, clientY - panelRect.top + 8);

  commentPopover.hidden = false;
  commentPopover.style.left = `${left}px`;
  commentPopover.style.top = `${top}px`;
  commentInput.value = '';
  commentInput.focus();
}

function hideCommentPopover(): void {
  commentPopover.hidden = true;
  pendingCommentRange = null;
}

function showCommentDisplay(commentAnchor: HTMLElement): void {
  const comment = commentAnchor.dataset.commentValue ?? '';
  const commentId = commentAnchor.dataset.commentId ?? null;
  if (commentId === null) {
    hideCommentDisplay();
    return;
  }
  hideInlineActions();
  hideCommentPopover();

  setActiveCommentId(commentId);
  commentDisplay.dataset.commentId = commentId;
  commentDisplayText.textContent = comment;
  commentDisplay.hidden = false;

  const anchorRect = commentAnchor.getBoundingClientRect();
  const panel = renderedReview.closest<HTMLElement>('.editor-surface');
  const panelRect = panel?.getBoundingClientRect() ?? renderedReview.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchorRect.left - panelRect.left, panelRect.width - 280));
  const top = Math.max(8, anchorRect.bottom - panelRect.top + 8);
  commentDisplay.style.left = `${left}px`;
  commentDisplay.style.top = `${top}px`;
}

function hideCommentDisplay(): void {
  commentDisplay.hidden = true;
  setActiveCommentId(null);
  commentDisplay.removeAttribute('data-comment-id');
  commentDisplayText.textContent = '';
}

function addCommentFromSelection(): void {
  const comment = commentInput.value.trim() || 'Comment';
  const range = pendingCommentRange;
  if (range === null) {
    hideCommentPopover();
    return;
  }

  const modelRange = clampRange(range, editorModel.text.length);
  const commentRecord: ReviewComment = {
    ...modelRange,
    id: nextAnnotationId(editorModel),
    value: comment,
  };

  window.getSelection()?.removeAllRanges();
  editorModel = {
    ...editorModel,
    comments: [...editorModel.comments, commentRecord].sort(compareRanges),
  };
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
  statusPill.textContent = 'Comment added';
}

function deleteComment(commentId: string): void {
  const nextComments = editorModel.comments.filter(comment => comment.id !== commentId);
  if (nextComments.length === editorModel.comments.length) {
    hideCommentDisplay();
    return;
  }
  if (!window.confirm('Delete this comment?')) {
    return;
  }

  editorModel = {
    ...editorModel,
    comments: nextComments,
  };
  activeChangeIndex = null;
  activeCommentId = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
  statusPill.textContent = 'Comment deleted';
}

function selectionWithinRenderedReview(selection: Selection | null): boolean {
  if (selection === null || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  return (
    renderedReview.contains(range.commonAncestorContainer) ||
    range.commonAncestorContainer === renderedReview
  );
}

function clearLongTouchTimer(): void {
  window.clearTimeout(longTouchTimer);
}

function toggleToolbarPopover(popover: HTMLElement, trigger: HTMLButtonElement): void {
  const isHidden = popover.hidden;
  popover.hidden = !isHidden;
  trigger.setAttribute('aria-expanded', String(isHidden));
}

function hideToolbarPopover(popover: HTMLElement, trigger: HTMLButtonElement): void {
  popover.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function modelForEditorDisplay(model: ReviewModel, viewMode: ViewMode): ReviewModel {
  const visibleModel = modelForView(model, viewMode);
  if (commentsVisible) {
    return visibleModel;
  }

  return {
    ...visibleModel,
    comments: [],
  };
}

function suggestionRange(suggestion: ReviewModel['suggestions'][number]): ReviewRange {
  const ranges = [suggestion.oldRange, suggestion.newRange].filter(
    (range): range is ReviewRange => range !== undefined,
  );
  if (ranges.length === 0) {
    return {end: 0, start: 0};
  }

  return {
    end: Math.max(...ranges.map(range => range.end)),
    start: Math.min(...ranges.map(range => range.start)),
  };
}

function renderMetrics(model: ReviewModel): string {
  const counts = {
    addition: 0,
    comment: model.comments.length,
    deletion: 0,
    highlight: model.highlights.length,
    substitution: 0,
  };

  for (const suggestion of model.suggestions) {
    counts[suggestion.type] += 1;
  }

  return Object.entries(counts)
    .map(([label, value]) => `<span><strong>${value}</strong>${label}</span>`)
    .join('');
}

function textDiff(before: string, after: string): {newValue: string; oldValue: string; start: number} {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
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

function nextAnnotationId(model: {readonly comments: readonly ReviewComment[]}): string {
  return `c-local-${model.comments.length + 1}-${Date.now()}`;
}

function compareRanges(left: ReviewRange, right: ReviewRange): number {
  return left.start - right.start || left.end - right.end;
}

function clampRange(range: ReviewRange, maxLength: number): ReviewRange {
  const start = Math.max(0, Math.min(range.start, maxLength));
  const end = Math.max(0, Math.min(range.end, maxLength));
  return start <= end ? {end, start} : {end: start, start: end};
}

function cloneReviewModel(model: ReviewModel): ReviewModel {
  return {
    comments: model.comments.map(comment => ({...comment})),
    highlights: model.highlights.map(highlight => ({...highlight})),
    suggestions: model.suggestions.map(suggestion => ({...suggestion})),
    text: model.text,
  };
}

function emptyReviewModel(): ReviewModel {
  return {comments: [], highlights: [], suggestions: [], text: ''};
}

function markdownInlineToHtml(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
