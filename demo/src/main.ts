import './styles.css';

import {
  beforeAfterToCriticMarkup,
  finalizeCriticMarkup,
  listCriticMarkupChanges,
  parseCriticMarkup,
  resolveCriticMarkupChange,
  type CriticMarkupChange,
  type CriticMarkupChangeDecision,
  type CriticMarkupNode,
} from '../../src/index';

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
const statusPill = getElement<HTMLElement>('status-pill');

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
  criticInput.value = resolveCriticMarkupChange(criticInput.value, changeIndex, decision);
  renderCriticMarkup();
});

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
  renderedReview.innerHTML = renderNodes(nodes);
  finalOutput.value = finalizeCriticMarkup(nodes);
  cleanOutput.value = finalizeCriticMarkup(nodes, {preserveComments: false});
  metrics.innerHTML = renderMetrics(nodes);
  changeList.innerHTML = renderChangeList(listCriticMarkupChanges(nodes));
  statusPill.textContent =
    criticInput.value === beforeAfterToCriticMarkup(beforeInput.value, afterInput.value)
      ? 'Synced'
      : 'Edited';
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
      <code>${escapeHtml(change.oldValue || 'empty')}</code>
      <span class="arrow">to</span>
      <code>${escapeHtml(change.newValue || 'empty')}</code>
    </div>
    <div class="change-actions">
      <button type="button" data-testid="accept-change" data-change-index="${change.changeIndex}" data-decision="accept">Accept</button>
      <button type="button" data-testid="reject-change" data-change-index="${change.changeIndex}" data-decision="reject">Reject</button>
    </div>
  </section>`;
}

function renderNodes(nodes: readonly CriticMarkupNode[]): string {
  if (nodes.length === 0) {
    return '<p class="empty">No content</p>';
  }

  return nodes.map(renderNode).join('');
}

function renderNode(node: CriticMarkupNode): string {
  switch (node.type) {
    case 'text':
      return markdownInlineToHtml(node.value);
    case 'addition':
      return `<ins>${markdownInlineToHtml(node.value)}</ins>`;
    case 'deletion':
      return `<del>${markdownInlineToHtml(node.value)}</del>`;
    case 'substitution':
      return `<span class="substitution"><del>${markdownInlineToHtml(
        node.oldValue,
      )}</del><span class="arrow">to</span><ins>${markdownInlineToHtml(
        node.newValue,
      )}</ins></span>`;
    case 'comment':
      return `<span class="comment">Comment: ${escapeHtml(node.value)}</span>`;
    case 'highlight':
      return `<mark>${markdownInlineToHtml(node.value)}</mark>`;
  }
}

function renderMetrics(nodes: readonly CriticMarkupNode[]): string {
  const counts = {
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
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />');
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
