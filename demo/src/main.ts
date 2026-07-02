import './styles.css';

import {
  beforeAfterToCriticMarkup,
  criticMarkupToReviewModel,
  finalizeReviewModel,
  insertReviewText,
  listReviewChanges,
  resolveReviewModelChange,
  reviewModelToCriticMarkup,
  withAddedSuggestion,
  type ReviewChange,
  type ReviewChangeDecision,
  type ReviewComment,
  type ReviewHighlight,
  type ReviewModel,
  type ReviewRange,
  type ReviewSuggestion,
} from '../../src/index';

type ViewMode = 'accept' | 'reject' | 'revisions';

const sampleBefore = 'this is **a great idea** for us.\n\nPlease ship the first draft.';
const sampleAfter = 'this **great** for us\n\nPlease ship the polished draft.';
const sampleRangeComment = 'Range comment: tighten the action wording';
const samplePointComment = 'Point comment: confirm the delivery owner';

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
const infoPopover = getElement<HTMLElement>('info-popover');
const infoToggle = getElement<HTMLButtonElement>('info-toggle');
const statusPill = getElement<HTMLElement>('status-pill');
const viewModeMenu = getElement<HTMLElement>('view-mode-menu');
const viewModeToggle = getElement<HTMLButtonElement>('view-mode-toggle');
const viewModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-view-mode]'),
);
let activeViewMode: ViewMode = 'revisions';
let activeChangeIndex: number | null = null;
let editorModel: ReviewModel = emptyReviewModel();
let editBaselineModel: ReviewModel = emptyReviewModel();
let longTouchTimer = 0;
let pendingCommentRange: Range | null = null;

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
changeList.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-change-index][data-decision]',
  );
  if (button === null) {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-index]');
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
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-index]');
  if (card !== null) {
    setActiveChangeIndex(Number(card.dataset.suggestionIndex));
  }
});
renderedReview.addEventListener('beforeinput', () => {
  editBaselineModel = cloneReviewModel(editorModel);
});
renderedReview.addEventListener('click', event => {
  const commentAnchor = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-comment-value]',
  );
  if (commentAnchor !== null) {
    showCommentDisplay(commentAnchor);
    return;
  }

  const changeElement = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-change-index]',
  );
  if (changeElement === null) {
    hideInlineActions();
    setActiveChangeIndex(null);
    hideCommentDisplay();
    return;
  }
  showInlineActions(changeElement);
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
renderedReview.addEventListener('input', () => {
  applyRenderedEditAsSuggestion();
});
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
  editBaselineModel = cloneReviewModel(editorModel);
  activeViewMode = 'revisions';
  for (const button of viewModeButtons) {
    button.classList.toggle('active', button.dataset.viewMode === activeViewMode);
  }
  renderEditorOutput();
}

function loadEditorInput(): void {
  editorModel = criticMarkupToReviewModel(editorInput.value);
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  renderEditorOutput();
}

function updateGeneratedOnly(): void {
  const generated = buildEditorInputFromBeforeAfter();
  statusPill.textContent = generated === editorInput.value ? 'Input synced' : 'Input stale';
}

function renderEditorOutput(): void {
  const visibleModel = modelForView(editorModel, activeViewMode);
  renderedReview.innerHTML = renderReviewModel(visibleModel, activeViewMode);
  renderedReview.contentEditable = activeViewMode === 'revisions' ? 'true' : 'false';
  refreshDerivedPanels();
}

function refreshDerivedPanels(): void {
  editorOutput.value = reviewModelToCriticMarkup(editorModel);
  finalOutput.value = finalizeReviewModel(editorModel);
  cleanOutput.value = finalizeReviewModel(editorModel, {preserveComments: false});
  metrics.innerHTML = renderMetrics(editorModel);
  changeList.innerHTML = renderChangeList(listReviewChanges(editorModel));
  syncActiveSuggestionState();
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

function renderChangeList(changes: readonly ReviewChange[]): string {
  if (changes.length === 0) {
    return '<p class="empty">No pending change markers</p>';
  }

  return changes.map(renderChangeCard).join('');
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

function renderReviewModel(model: ReviewModel, viewMode: ViewMode): string {
  if (model.text.length === 0) {
    return '<p class="empty">No content</p>';
  }

  const boundaries = modelBoundaries(model);
  let html = '';
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined) {
      continue;
    }

    html += renderPointCommentsAt(model, start);
    if (end === undefined || end === start) {
      continue;
    }

    html += renderTextSegment(model, {start, end});
  }
  return html;
}

function modelBoundaries(model: ReviewModel): number[] {
  const boundaries = new Set<number>([0, model.text.length]);
  for (const suggestion of model.suggestions) {
    addRangeBoundaries(boundaries, suggestion.oldRange);
    addRangeBoundaries(boundaries, suggestion.newRange);
  }
  for (const comment of model.comments) {
    boundaries.add(comment.start);
    boundaries.add(comment.end);
  }
  for (const highlight of model.highlights) {
    boundaries.add(highlight.start);
    boundaries.add(highlight.end);
  }
  return Array.from(boundaries).sort((left, right) => left - right);
}

function addRangeBoundaries(boundaries: Set<number>, range: ReviewRange | undefined): void {
  if (range === undefined) {
    return;
  }
  boundaries.add(range.start);
  boundaries.add(range.end);
}

function renderTextSegment(model: ReviewModel, range: ReviewRange): string {
  const value = markdownInlineToHtml(model.text.slice(range.start, range.end));
  const suggestionPart = suggestionPartForRange(model, range);
  const comment = model.comments.find(
    item => item.start !== item.end && item.start <= range.start && item.end >= range.end,
  );
  const highlight = model.highlights.find(
    item => item.start <= range.start && item.end >= range.end,
  );

  if (suggestionPart !== null) {
    const changeIndex = model.suggestions.findIndex(
      suggestion => suggestion.id === suggestionPart.suggestion.id,
    );
    const tag = suggestionPart.part === 'new' ? 'ins' : 'del';
    const className = suggestionPart.part === 'new'
      ? 'review-change review-addition'
      : 'review-change review-deletion';
    const commentAttributes = comment === undefined ? '' : commentDataAttributes(comment);
    return `<${tag} class="${className}" data-suggestion-id="${suggestionPart.suggestion.id}" data-suggestion-part="${suggestionPart.part}" data-change-index="${changeIndex}" data-change-kind="${suggestionPart.suggestion.type}"${commentAttributes} tabindex="0">${value}</${tag}>`;
  }

  if (comment !== undefined) {
    return `<mark ${commentDataAttributes(comment).trim()} data-testid="range-comment" tabindex="0">${value}</mark>`;
  }

  if (highlight !== undefined) {
    return `<mark data-highlight-id="${highlight.id}">${value}</mark>`;
  }

  return value;
}

function suggestionPartForRange(
  model: ReviewModel,
  range: ReviewRange,
): {part: 'new' | 'old'; suggestion: ReviewSuggestion} | null {
  for (const suggestion of model.suggestions) {
    if (rangeContains(suggestion.oldRange, range)) {
      return {part: 'old', suggestion};
    }
    if (rangeContains(suggestion.newRange, range)) {
      return {part: 'new', suggestion};
    }
  }
  return null;
}

function rangeContains(container: ReviewRange | undefined, range: ReviewRange): boolean {
  return container !== undefined && container.start <= range.start && container.end >= range.end;
}

function renderPointCommentsAt(model: ReviewModel, offset: number): string {
  return model.comments
    .filter(comment => comment.start === offset && comment.end === offset)
    .map(renderCommentAnchor)
    .join('');
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

function renderCommentAnchor(comment: ReviewComment): string {
  return `<button type="button" class="comment-anchor" data-comment-id="${comment.id}" data-comment-value="${escapeHtml(comment.value)}" data-testid="comment-anchor" contenteditable="false" aria-label="Show comment">${commentIconSvg()}</button>`;
}

function commentIconSvg(): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3V5Z"></path></svg>`;
}

function commentDataAttributes(comment: ReviewComment): string {
  return ` data-comment-id="${comment.id}" data-comment-value="${escapeHtml(comment.value)}"`;
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
  syncActiveSuggestionState();
}

function syncActiveSuggestionState(): void {
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
}

function applyRenderedEditAsSuggestion(): void {
  if (activeViewMode !== 'revisions') {
    renderEditorOutput();
    return;
  }

  const domModel = renderedDomToReviewModel(renderedReview, editBaselineModel);
  const nextModel = reconcileRenderedEdit(editBaselineModel, domModel);
  const shouldRerenderEditor = nextModel !== domModel;
  editorModel = nextModel;
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideInlineActions();
  hideCommentPopover();
  hideCommentDisplay();
  if (shouldRerenderEditor) {
    renderEditorOutput();
    statusPill.textContent = 'Suggestion added';
  } else {
    refreshDerivedPanels();
    statusPill.textContent = 'Suggestion updated';
  }
}

function showCommentPopover(clientX: number, clientY: number): void {
  hideInlineActions();
  hideCommentDisplay();
  const selection = window.getSelection();
  pendingCommentRange = selectionWithinRenderedReview(selection)
    ? selection!.getRangeAt(0).cloneRange()
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
  hideInlineActions();
  hideCommentPopover();
  setActiveChangeIndex(null);

  commentDisplay.textContent = comment;
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
}

function addCommentFromSelection(): void {
  const comment = commentInput.value.trim() || 'Comment';
  const range = pendingCommentRange;
  if (range === null || !renderedReview.contains(range.commonAncestorContainer)) {
    hideCommentPopover();
    return;
  }

  if (range.collapsed) {
    const commentElement = createCommentElement(comment);
    range.insertNode(commentElement);
  } else {
    const selectedFragment = range.extractContents();
    const mark = document.createElement('mark');
    mark.dataset.commentId = nextAnnotationId(editorModel);
    mark.dataset.commentValue = comment;
    mark.dataset.testid = 'range-comment';
    mark.tabIndex = 0;
    mark.append(selectedFragment);
    range.insertNode(mark);
  }

  window.getSelection()?.removeAllRanges();
  editorModel = renderedDomToReviewModel(renderedReview, editorModel);
  activeChangeIndex = null;
  editBaselineModel = cloneReviewModel(editorModel);
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
  statusPill.textContent = 'Comment added';
}

function createCommentElement(comment: string): HTMLElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'comment-anchor';
  element.dataset.commentId = nextAnnotationId(editorModel);
  element.dataset.commentValue = comment;
  element.setAttribute('aria-label', 'Show comment');
  element.contentEditable = 'false';
  element.innerHTML = commentIconSvg();
  return element;
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

function renderedDomToReviewModel(root: HTMLElement, baseline: ReviewModel): ReviewModel {
  const suggestions = new Map<string, MutableSuggestion>();
  const comments = new Map<string, ReviewComment>();
  const highlights = new Map<string, ReviewHighlight>();
  let text = '';

  for (const suggestion of baseline.suggestions) {
    suggestions.set(suggestion.id, {
      id: suggestion.id,
      type: suggestion.type,
    });
  }

  const appendText = (value: string): ReviewRange => {
    const start = text.length;
    text += value;
    return {end: text.length, start};
  };

  const appendChildren = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      appendNode(child);
    }
  };

  const appendNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.nodeValue ?? '');
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.matches('.comment-anchor')) {
      const id = node.dataset.commentId ?? nextAnnotationId({comments: Array.from(comments.values())});
      comments.set(id, {
        end: text.length,
        id,
        start: text.length,
        value: node.dataset.commentValue ?? '',
      });
      return;
    }

    if (node.tagName === 'BR') {
      appendText('\n');
      return;
    }

    const start = text.length;
    if (node.tagName === 'STRONG' || node.tagName === 'B') {
      appendText('**');
      appendChildren(node);
      appendText('**');
    } else if (node.tagName === 'CODE') {
      appendText('`');
      appendChildren(node);
      appendText('`');
    } else {
      appendChildren(node);
      if (node.tagName === 'DIV' || node.tagName === 'P') {
        appendText('\n');
      }
    }
    const end = text.length;
    if (end === start) {
      return;
    }

    const suggestionId = node.dataset.suggestionId;
    const suggestionPart = node.dataset.suggestionPart;
    if (suggestionId !== undefined && (suggestionPart === 'old' || suggestionPart === 'new')) {
      const baselineSuggestion = baseline.suggestions.find(suggestion => suggestion.id === suggestionId);
      const suggestion = suggestions.get(suggestionId) ?? {
        id: suggestionId,
        type: baselineSuggestion?.type ?? (suggestionPart === 'new' ? 'addition' : 'deletion'),
      };
      mergeSuggestionRange(suggestion, suggestionPart, {start, end});
      suggestions.set(suggestionId, suggestion);
    }

    const commentId = node.dataset.commentId;
    if (commentId !== undefined) {
      comments.set(commentId, {
        end,
        id: commentId,
        start,
        value: node.dataset.commentValue ?? '',
      });
    }

    const highlightId = node.dataset.highlightId;
    if (highlightId !== undefined) {
      highlights.set(highlightId, {end, id: highlightId, start});
    }
  };

  appendChildren(root);
  return {
    comments: Array.from(comments.values()).sort(compareRanges),
    highlights: Array.from(highlights.values()).sort(compareRanges),
    suggestions: Array.from(suggestions.values())
      .filter(hasSuggestionRange)
      .map(toReviewSuggestion)
      .sort((left, right) => suggestionModelStart(left) - suggestionModelStart(right)),
    text,
  };
}

function reconcileRenderedEdit(baseline: ReviewModel, domModel: ReviewModel): ReviewModel {
  const diff = textDiff(baseline.text, domModel.text);
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
    return withAddedSuggestion(domModel, {
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

  const expanded = insertReviewText(domModel, diff.start, diff.oldValue);
  return withAddedSuggestion(expanded, {
    newRange: {
      end: diff.start + diff.oldValue.length + diff.newValue.length,
      start: diff.start + diff.oldValue.length,
    },
    oldRange,
    type: 'substitution',
  });
}

function modelForView(model: ReviewModel, viewMode: ViewMode): ReviewModel {
  if (viewMode === 'revisions') {
    return model;
  }

  let nextModel = cloneReviewModel(model);
  const decision = viewMode === 'accept' ? 'accept' : 'reject';
  for (let index = nextModel.suggestions.length - 1; index >= 0; index -= 1) {
    nextModel = resolveReviewModelChange(nextModel, index, decision);
  }
  return nextModel;
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

function nextAnnotationId(model: {readonly comments: readonly ReviewComment[]}): string {
  return `c-local-${model.comments.length + 1}-${Date.now()}`;
}

type MutableSuggestion = {
  id: string;
  newRange?: ReviewRange;
  oldRange?: ReviewRange;
  type: ReviewSuggestion['type'];
};

function mergeSuggestionRange(
  suggestion: MutableSuggestion,
  part: 'new' | 'old',
  range: ReviewRange,
): void {
  const key = part === 'new' ? 'newRange' : 'oldRange';
  const current = suggestion[key];
  suggestion[key] = current === undefined
    ? range
    : {end: Math.max(current.end, range.end), start: Math.min(current.start, range.start)};
}

function hasSuggestionRange(suggestion: MutableSuggestion): boolean {
  return suggestion.oldRange !== undefined || suggestion.newRange !== undefined;
}

function toReviewSuggestion(suggestion: MutableSuggestion): ReviewSuggestion {
  const next: ReviewSuggestion = {
    id: suggestion.id,
    type: suggestion.type,
  };
  if (suggestion.oldRange !== undefined && suggestion.newRange !== undefined) {
    return {...next, newRange: suggestion.newRange, oldRange: suggestion.oldRange};
  }
  if (suggestion.oldRange !== undefined) {
    return {...next, oldRange: suggestion.oldRange};
  }
  return suggestion.newRange === undefined ? next : {...next, newRange: suggestion.newRange};
}

function compareRanges(left: ReviewRange, right: ReviewRange): number {
  return left.start - right.start || left.end - right.end;
}

function suggestionModelStart(suggestion: ReviewSuggestion): number {
  return Math.min(
    suggestion.oldRange?.start ?? Number.POSITIVE_INFINITY,
    suggestion.newRange?.start ?? Number.POSITIVE_INFINITY,
  );
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
