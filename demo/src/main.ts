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

const beforeInput = getElement<HTMLTextAreaElement>('before-input');
const afterInput = getElement<HTMLTextAreaElement>('after-input');
const criticInput = getElement<HTMLTextAreaElement>('critic-input');
const finalOutput = getElement<HTMLTextAreaElement>('final-output');
const cleanOutput = getElement<HTMLTextAreaElement>('clean-output');
const renderedReview = getElement<HTMLElement>('rendered-review');
const metrics = getElement<HTMLElement>('metrics');
const changeList = getElement<HTMLElement>('change-list');
const inlineReviewActions = getElement<HTMLElement>('inline-review-actions');
const statusPill = getElement<HTMLElement>('status-pill');
const viewModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-view-mode]'),
);
let activeViewMode: ViewMode = 'revisions';

beforeInput.value = sampleBefore;
afterInput.value = sampleAfter;

getElement<HTMLButtonElement>('reset-sample').addEventListener('click', () => {
  beforeInput.value = sampleBefore;
  afterInput.value = sampleAfter;
  syncCriticMarkup();
});

getElement<HTMLButtonElement>('sync-review').addEventListener('click', syncCriticMarkup);

beforeInput.addEventListener('input', updateGeneratedOnly);
afterInput.addEventListener('input', updateGeneratedOnly);
criticInput.addEventListener('input', renderCriticMarkup);
changeList.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-change-index][data-decision]',
  );
  if (button === null) {
    return;
  }

  const changeIndex = Number(button.dataset.changeIndex);
  const decision = button.dataset.decision as CriticMarkupChangeDecision;
  resolveChange(changeIndex, decision);
});
renderedReview.addEventListener('click', event => {
  const changeElement = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-change-index]',
  );
  if (changeElement === null) {
    hideInlineActions();
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
    return;
  }
  showInlineActions(changeElement);
});
renderedReview.addEventListener('input', () => {
  criticInput.value = renderedReviewToCriticMarkup(renderedReview, activeViewMode);
  refreshDerivedPanels(parseCriticMarkup(criticInput.value));
  statusPill.textContent = 'Preview edited';
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
for (const button of viewModeButtons) {
  button.addEventListener('click', () => {
    activeViewMode = button.dataset.viewMode as ViewMode;
    for (const nextButton of viewModeButtons) {
      nextButton.classList.toggle('active', nextButton === button);
    }
    hideInlineActions();
    renderCriticMarkup();
  });
}

syncCriticMarkup();

function syncCriticMarkup(): void {
  criticInput.value = beforeAfterToCriticMarkup(beforeInput.value, afterInput.value);
  renderCriticMarkup();
}

function updateGeneratedOnly(): void {
  const generated = beforeAfterToCriticMarkup(beforeInput.value, afterInput.value);
  statusPill.textContent = generated === criticInput.value ? 'Synced' : 'Unsynced';
}

function renderCriticMarkup(): void {
  const nodes = parseCriticMarkup(criticInput.value);
  renderedReview.innerHTML = renderNodes(nodes, activeViewMode);
  refreshDerivedPanels(nodes);
}

function refreshDerivedPanels(nodes: readonly CriticMarkupNode[]): void {
  finalOutput.value = finalizeCriticMarkup(nodes);
  cleanOutput.value = finalizeCriticMarkup(nodes, {preserveComments: false});
  metrics.innerHTML = renderMetrics(nodes);
  changeList.innerHTML = renderChangeList(listCriticMarkupChanges(nodes));
  statusPill.textContent =
    criticInput.value === beforeAfterToCriticMarkup(beforeInput.value, afterInput.value)
      ? 'Synced'
      : 'Edited';
}

function resolveChange(
  changeIndex: number,
  decision: CriticMarkupChangeDecision,
): void {
  criticInput.value = resolveCriticMarkupChange(criticInput.value, changeIndex, decision);
  hideInlineActions();
  renderCriticMarkup();
}

function renderChangeList(changes: readonly CriticMarkupChange[]): string {
  if (changes.length === 0) {
    return '<p class="empty">No pending change markers</p>';
  }

  return changes.map(renderChangeCard).join('');
}

function renderChangeCard(change: CriticMarkupChange): string {
  return `<section class="change-card">
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
      return `<ins class="review-change review-addition" data-change-index="${changeIndex}" data-change-kind="addition" tabindex="0">${markdownInlineToHtml(node.value)}</ins>`;
    case 'deletion':
      if (viewMode === 'accept') {
        return '';
      }
      if (viewMode === 'reject') {
        return markdownInlineToHtml(node.value);
      }
      return `<del class="review-change review-deletion" data-change-index="${changeIndex}" data-change-kind="deletion" tabindex="0">${markdownInlineToHtml(node.value)}</del>`;
    case 'substitution':
      if (viewMode === 'accept') {
        return markdownInlineToHtml(node.newValue);
      }
      if (viewMode === 'reject') {
        return markdownInlineToHtml(node.oldValue);
      }
      return `<del class="review-change review-deletion" data-change-index="${changeIndex}" data-change-kind="substitution" data-change-part="old" tabindex="0">${markdownInlineToHtml(
        node.oldValue,
      )}</del><ins class="review-change review-addition" data-change-index="${changeIndex}" data-change-kind="substitution" data-change-part="new" tabindex="0">${markdownInlineToHtml(
        node.newValue,
      )}</ins>`;
    case 'comment':
      return `<span class="comment" data-critic-type="comment">Comment: ${escapeHtml(node.value)}</span>`;
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

function isChangeNode(node: CriticMarkupNode): boolean {
  return node.type === 'addition' || node.type === 'deletion' || node.type === 'substitution';
}

function showInlineActions(changeElement: HTMLElement): void {
  inlineReviewActions.dataset.changeIndex = changeElement.dataset.changeIndex ?? '';
  inlineReviewActions.hidden = false;

  const changeRect = changeElement.getBoundingClientRect();
  const panel = renderedReview.closest<HTMLElement>('.preview-panel');
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
  return element.textContent?.replace(/^Comment:\s*/, '') ?? '';
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
