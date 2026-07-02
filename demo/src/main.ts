import './styles.css';

import {
  beforeAfterToCriticMarkup,
  finalizeCriticMarkup,
  listCriticMarkupChanges,
  parseCriticMarkup,
  resolveCriticMarkupChange,
  serializeCriticMarkup,
  type CriticMarkupChange,
  type CriticMarkupChangeDecision,
  type CriticMarkupNode,
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
let editBaselineCriticMarkup = '';
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
  const decision = button.dataset.decision as CriticMarkupChangeDecision;
  resolveChange(changeIndex, decision);
});
changeList.addEventListener('focusin', event => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-index]');
  if (card !== null) {
    setActiveChangeIndex(Number(card.dataset.suggestionIndex));
  }
});
renderedReview.addEventListener('beforeinput', () => {
  editBaselineCriticMarkup = editorOutput.value;
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
  const decision = button.dataset.inlineDecision as CriticMarkupChangeDecision;
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
  editorOutput.value = criticMarkup;
  activeChangeIndex = null;
  editBaselineCriticMarkup = criticMarkup;
  activeViewMode = 'revisions';
  for (const button of viewModeButtons) {
    button.classList.toggle('active', button.dataset.viewMode === activeViewMode);
  }
  renderEditorOutput();
}

function loadEditorInput(): void {
  editorOutput.value = editorInput.value;
  activeChangeIndex = null;
  editBaselineCriticMarkup = editorOutput.value;
  renderEditorOutput();
}

function updateGeneratedOnly(): void {
  const generated = buildEditorInputFromBeforeAfter();
  statusPill.textContent = generated === editorInput.value ? 'Input synced' : 'Input stale';
}

function renderEditorOutput(): void {
  const nodes = parseCriticMarkup(editorOutput.value);
  renderedReview.innerHTML = renderNodes(nodes, activeViewMode);
  renderedReview.contentEditable = activeViewMode === 'revisions' ? 'true' : 'false';
  refreshDerivedPanels(nodes);
}

function refreshDerivedPanels(nodes: readonly CriticMarkupNode[]): void {
  finalOutput.value = finalizeCriticMarkup(nodes);
  cleanOutput.value = finalizeCriticMarkup(nodes, {preserveComments: false});
  metrics.innerHTML = renderMetrics(nodes);
  changeList.innerHTML = renderChangeList(listCriticMarkupChanges(nodes));
  syncActiveSuggestionState();
  statusPill.textContent =
    editorOutput.value === editorInput.value
      ? 'Loaded'
      : 'Edited';
}

function resolveChange(
  changeIndex: number,
  decision: CriticMarkupChangeDecision,
): void {
  editorOutput.value = resolveCriticMarkupChange(editorOutput.value, changeIndex, decision);
  activeChangeIndex = null;
  editBaselineCriticMarkup = editorOutput.value;
  hideInlineActions();
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
}

function renderChangeList(changes: readonly CriticMarkupChange[]): string {
  if (changes.length === 0) {
    return '<p class="empty">No pending change markers</p>';
  }

  return changes.map(renderChangeCard).join('');
}

function renderChangeCard(change: CriticMarkupChange): string {
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

function renderNodes(nodes: readonly CriticMarkupNode[], viewMode: ViewMode): string {
  if (nodes.length === 0) {
    return '<p class="empty">No content</p>';
  }

  let changeIndex = 0;
  let html = '';
  for (const node of nodes) {
    html += renderNode(node, viewMode, changeIndex);
    if (isChangeNode(node)) {
      changeIndex += 1;
    }
  }
  return html;
}

function renderNode(
  node: CriticMarkupNode,
  viewMode: ViewMode,
  changeIndex: number,
): string {
  switch (node.type) {
    case 'text':
      return markdownInlineToHtml(node.value);
    case 'addition':
      if (viewMode === 'reject') {
        return '';
      }
      if (viewMode === 'accept') {
        return markdownInlineToHtml(node.value);
      }
      return `<ins class="review-change review-addition" data-change-index="${changeIndex}" data-change-kind="addition" contenteditable="false" tabindex="0">${markdownInlineToHtml(node.value)}</ins>`;
    case 'deletion':
      if (viewMode === 'accept') {
        return '';
      }
      if (viewMode === 'reject') {
        return markdownInlineToHtml(node.value);
      }
      return `<del class="review-change review-deletion" data-change-index="${changeIndex}" data-change-kind="deletion" contenteditable="false" tabindex="0">${markdownInlineToHtml(node.value)}</del>`;
    case 'substitution':
      if (viewMode === 'accept') {
        return markdownInlineToHtml(node.newValue);
      }
      if (viewMode === 'reject') {
        return markdownInlineToHtml(node.oldValue);
      }
      return `<del class="review-change review-deletion" data-change-index="${changeIndex}" data-change-kind="substitution" data-change-part="old" contenteditable="false" tabindex="0">${markdownInlineToHtml(
        node.oldValue,
      )}</del><ins class="review-change review-addition" data-change-index="${changeIndex}" data-change-kind="substitution" data-change-part="new" contenteditable="false" tabindex="0">${markdownInlineToHtml(
        node.newValue,
      )}</ins>`;
    case 'comment':
      return renderCommentAnchor(node.value);
    case 'highlight':
      return `<mark data-critic-type="highlight">${markdownInlineToHtml(node.value)}</mark>`;
  }
  return assertNever(node);
}

function describeChange(change: CriticMarkupChange): string {
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

function renderCommentAnchor(value: string): string {
  const comment = escapeHtml(value);
  return `<button type="button" class="comment-anchor" data-critic-type="comment" data-comment-value="${comment}" data-testid="comment-anchor" contenteditable="false" aria-label="Show comment">${commentIconSvg()}</button>`;
}

function commentIconSvg(): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3V5Z"></path></svg>`;
}

function isChangeNode(node: CriticMarkupNode): boolean {
  return node.type === 'addition' || node.type === 'deletion' || node.type === 'substitution';
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

  const baseline = editBaselineCriticMarkup || editorOutput.value;
  const editedCriticMarkup = renderedReviewToCriticMarkup(renderedReview, activeViewMode);
  editorOutput.value = beforeAfterToCriticMarkup(baseline, editedCriticMarkup);
  activeChangeIndex = null;
  editBaselineCriticMarkup = editorOutput.value;
  hideInlineActions();
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
  statusPill.textContent = 'Suggestion added';
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
    mark.dataset.criticType = 'highlight';
    mark.append(selectedFragment);
    const commentElement = createCommentElement(comment);
    range.insertNode(commentElement);
    range.insertNode(mark);
  }

  window.getSelection()?.removeAllRanges();
  editorOutput.value = renderedReviewToCriticMarkup(renderedReview, activeViewMode);
  activeChangeIndex = null;
  editBaselineCriticMarkup = editorOutput.value;
  hideCommentPopover();
  hideCommentDisplay();
  renderEditorOutput();
  statusPill.textContent = 'Comment added';
}

function createCommentElement(comment: string): HTMLElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'comment-anchor';
  element.dataset.criticType = 'comment';
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

function renderedReviewToCriticMarkup(root: HTMLElement, viewMode: ViewMode): string {
  if (viewMode !== 'revisions') {
    return serializeCriticMarkup([{type: 'text', value: childNodesToMarkdown(root.childNodes)}]);
  }

  return childNodesToCriticMarkup(root.childNodes);
}

function childNodesToCriticMarkup(nodes: NodeListOf<ChildNode>): string {
  const childNodes = Array.from(nodes);
  let output = '';

  for (let index = 0; index < childNodes.length; index += 1) {
    const node = childNodes[index];
    if (node === undefined) {
      continue;
    }

    const element = node instanceof HTMLElement ? node : null;
    const changeKind = element?.dataset.changeKind;

    if (element !== null && changeKind === 'addition') {
      output += serializeCriticMarkup([
        {type: 'addition', value: childNodesToMarkdown(element.childNodes)},
      ]);
      continue;
    }

    if (element !== null && changeKind === 'deletion') {
      output += serializeCriticMarkup([
        {type: 'deletion', value: childNodesToMarkdown(element.childNodes)},
      ]);
      continue;
    }

    if (element !== null && changeKind === 'substitution') {
      const substitution = collectSubstitutionParts(childNodes, index);
      output += serializeCriticMarkup([
        {
          type: 'substitution',
          oldValue: substitution.oldValue,
          newValue: substitution.newValue,
        },
      ]);
      index = substitution.endIndex;
      continue;
    }

    if (element?.dataset.criticType === 'comment') {
      output += serializeCriticMarkup([{type: 'comment', value: commentElementValue(element)}]);
      continue;
    }

    if (element?.dataset.criticType === 'highlight') {
      output += serializeCriticMarkup([
        {type: 'highlight', value: childNodesToMarkdown(element.childNodes)},
      ]);
      continue;
    }

    output += serializeCriticMarkup([{type: 'text', value: nodeToMarkdown(node)}]);
  }

  return output;
}

function collectSubstitutionParts(
  nodes: readonly Node[],
  startIndex: number,
): {endIndex: number; newValue: string; oldValue: string} {
  const firstElement = nodes[startIndex];
  if (!(firstElement instanceof HTMLElement)) {
    return {endIndex: startIndex, newValue: '', oldValue: ''};
  }

  const changeIndex = firstElement.dataset.changeIndex;
  let endIndex = startIndex;
  let oldValue = '';
  let newValue = '';

  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!(node instanceof HTMLElement)) {
      break;
    }
    if (
      node.dataset.changeKind !== 'substitution' ||
      node.dataset.changeIndex !== changeIndex
    ) {
      break;
    }

    const markdown = childNodesToMarkdown(node.childNodes);
    if (node.dataset.changePart === 'old') {
      oldValue += markdown;
    } else {
      newValue += markdown;
    }
    endIndex = index;
  }

  return {endIndex, newValue, oldValue};
}

function childNodesToMarkdown(nodes: NodeListOf<ChildNode>): string {
  return Array.from(nodes)
    .map(nodeToMarkdown)
    .join('');
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? '';
  }

  if (!(node instanceof HTMLElement)) {
    return '';
  }

  switch (node.tagName) {
    case 'B':
    case 'STRONG':
      return `**${childNodesToMarkdown(node.childNodes)}**`;
    case 'BR':
      return '\n';
    case 'CODE':
      return `\`${childNodesToMarkdown(node.childNodes)}\``;
    case 'DIV':
    case 'P': {
      const value = childNodesToMarkdown(node.childNodes);
      return value.endsWith('\n') ? value : `${value}\n`;
    }
    default:
      return childNodesToMarkdown(node.childNodes);
  }
}

function commentElementValue(element: HTMLElement): string {
  return element.dataset.commentValue ?? element.textContent?.replace(/^Comment:\s*/, '') ?? '';
}

function renderMetrics(nodes: readonly CriticMarkupNode[]): string {
  const counts: Record<Exclude<CriticMarkupNode['type'], 'text'>, number> = {
    addition: 0,
    comment: 0,
    deletion: 0,
    highlight: 0,
    substitution: 0,
  };

  for (const node of nodes) {
    if (node.type !== 'text') {
      counts[node.type] += 1;
    }
  }

  return Object.entries(counts)
    .map(([label, value]) => `<span><strong>${value}</strong>${label}</span>`)
    .join('');
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
