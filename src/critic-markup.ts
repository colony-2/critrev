export type CriticMarkupNode =
  | {type: 'text'; value: string}
  | {type: 'addition'; value: string}
  | {type: 'deletion'; value: string}
  | {type: 'substitution'; newValue: string; oldValue: string}
  | {type: 'comment'; value: string}
  | {type: 'highlight'; value: string};

export type CriticMarkupParseOptions = {
  /**
   * When true, malformed markers are kept as literal text instead of throwing.
   * This should be the default for user-authored markdown.
   */
  readonly lenient?: boolean;
};

export type FinalizeCriticMarkupOptions = {
  /**
   * Preserve point comments and range comments in the final markdown.
   * Bare highlights are still unwrapped to their highlighted text.
   */
  readonly preserveComments?: boolean;
};

export type BeforeAfterToCriticMarkupOptions = {
  readonly normalizeLineEndings?: boolean;
};

export type CriticMarkupChangeDecision = 'accept' | 'reject';

export type CriticMarkupChange = {
  readonly changeIndex: number;
  readonly nodeIndex: number;
  readonly type: 'addition' | 'deletion' | 'substitution';
  readonly oldValue: string;
  readonly newValue: string;
};

type SimpleMarkerType = Exclude<CriticMarkupNode['type'], 'text' | 'substitution'>;

type SimpleMarker = {
  readonly close: string;
  readonly open: string;
  readonly type: SimpleMarkerType;
};

const SIMPLE_MARKERS: readonly SimpleMarker[] = [
  {type: 'addition', open: '{++', close: '++}'},
  {type: 'deletion', open: '{--', close: '--}'},
  {type: 'comment', open: '{>>', close: '<<}'},
  {type: 'highlight', open: '{==', close: '==}'},
];

const ESCAPABLE_TOKENS = [
  '{++',
  '++}',
  '{--',
  '--}',
  '{~~',
  '~>',
  '~~}',
  '{>>',
  '<<}',
  '{==',
  '==}',
] as const;

export function parseCriticMarkup(
  input: string,
  options: CriticMarkupParseOptions = {},
): CriticMarkupNode[] {
  const lenient = options.lenient ?? true;
  const nodes: CriticMarkupNode[] = [];
  let textStart = 0;
  let cursor = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      pushNode(nodes, {type: 'text', value: unescapeCriticMarkup(input.slice(textStart, end))});
    }
  };

  while (cursor < input.length) {
    if (input[cursor] !== '{' || isEscaped(input, cursor)) {
      cursor += 1;
      continue;
    }

    const simpleMarker = SIMPLE_MARKERS.find(marker =>
      input.startsWith(marker.open, cursor),
    );

    if (simpleMarker !== undefined) {
      const valueStart = cursor + simpleMarker.open.length;
      const closeIndex = findUnescaped(input, simpleMarker.close, valueStart);

      if (closeIndex === -1) {
        if (!lenient) {
          throw new Error(`Unclosed CriticMarkup ${simpleMarker.type} marker at ${cursor}`);
        }
        cursor += 1;
        continue;
      }

      pushText(cursor);
      pushNode(nodes, {
        type: simpleMarker.type,
        value: unescapeCriticMarkup(input.slice(valueStart, closeIndex)),
      });
      cursor = closeIndex + simpleMarker.close.length;
      textStart = cursor;
      continue;
    }

    if (input.startsWith('{~~', cursor)) {
      const valueStart = cursor + '{~~'.length;
      const closeIndex = findUnescaped(input, '~~}', valueStart);

      if (closeIndex === -1) {
        if (!lenient) {
          throw new Error(`Unclosed CriticMarkup substitution marker at ${cursor}`);
        }
        cursor += 1;
        continue;
      }

      const separatorIndex = findUnescaped(input, '~>', valueStart, closeIndex);
      if (separatorIndex === -1) {
        if (!lenient) {
          throw new Error(`Missing CriticMarkup substitution separator at ${cursor}`);
        }
        cursor += 1;
        continue;
      }

      pushText(cursor);
      pushNode(nodes, {
        type: 'substitution',
        oldValue: unescapeCriticMarkup(input.slice(valueStart, separatorIndex)),
        newValue: unescapeCriticMarkup(input.slice(separatorIndex + '~>'.length, closeIndex)),
      });
      cursor = closeIndex + '~~}'.length;
      textStart = cursor;
      continue;
    }

    cursor += 1;
  }

  pushText(input.length);
  return nodes;
}

export function serializeCriticMarkup(nodes: readonly CriticMarkupNode[]): string {
  return nodes.map(serializeNode).join('');
}

export function finalizeCriticMarkup(
  input: string | readonly CriticMarkupNode[],
  options: FinalizeCriticMarkupOptions = {},
): string {
  const preserveComments = options.preserveComments ?? true;
  const nodes = typeof input === 'string' ? parseCriticMarkup(input) : input;
  let output = '';

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }

    switch (node.type) {
      case 'text':
        output += node.value;
        break;
      case 'addition':
        output += node.value;
        break;
      case 'deletion':
        break;
      case 'substitution':
        output += node.newValue;
        break;
      case 'comment':
        if (preserveComments) {
          output += serializeNode(node);
        }
        break;
      case 'highlight': {
        const nextNode = nodes[index + 1];
        const isRangeComment = nextNode?.type === 'comment';
        if (isRangeComment) {
          if (preserveComments) {
            output += serializeNode(node) + serializeNode(nextNode);
          } else {
            output += node.value;
          }
          index += 1;
        } else {
          output += node.value;
        }
        break;
      }
    }
  }

  return output;
}

export function beforeAfterToCriticMarkup(
  beforeMarkdown: string,
  afterMarkdown: string,
  options: BeforeAfterToCriticMarkupOptions = {},
): string {
  const normalizeLineEndings = options.normalizeLineEndings ?? true;
  const before = normalizeLineEndings ? normalizeNewlines(beforeMarkdown) : beforeMarkdown;
  const after = normalizeLineEndings ? normalizeNewlines(afterMarkdown) : afterMarkdown;
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const matches = lineMatches(beforeLines, afterLines);
  const outputLines: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  for (const match of matches) {
    appendChangedLines(
      outputLines,
      beforeLines.slice(beforeIndex, match.beforeIndex),
      afterLines.slice(afterIndex, match.afterIndex),
    );
    outputLines.push(beforeLines[match.beforeIndex] ?? '');
    beforeIndex = match.beforeIndex + 1;
    afterIndex = match.afterIndex + 1;
  }

  appendChangedLines(
    outputLines,
    beforeLines.slice(beforeIndex),
    afterLines.slice(afterIndex),
  );

  return outputLines.join('\n');
}

export function listCriticMarkupChanges(
  input: string | readonly CriticMarkupNode[],
): CriticMarkupChange[] {
  const nodes = typeof input === 'string' ? parseCriticMarkup(input) : input;
  const changes: CriticMarkupChange[] = [];

  nodes.forEach((node, nodeIndex) => {
    switch (node.type) {
      case 'addition':
        changes.push({
          changeIndex: changes.length,
          nodeIndex,
          type: 'addition',
          oldValue: '',
          newValue: node.value,
        });
        break;
      case 'deletion':
        changes.push({
          changeIndex: changes.length,
          nodeIndex,
          type: 'deletion',
          oldValue: node.value,
          newValue: '',
        });
        break;
      case 'substitution':
        changes.push({
          changeIndex: changes.length,
          nodeIndex,
          type: 'substitution',
          oldValue: node.oldValue,
          newValue: node.newValue,
        });
        break;
      case 'comment':
      case 'highlight':
      case 'text':
        break;
    }
  });

  return changes;
}

export function resolveCriticMarkupChange(
  input: string,
  changeIndex: number,
  decision: CriticMarkupChangeDecision,
): string {
  return serializeCriticMarkup(
    resolveCriticMarkupChangeNodes(parseCriticMarkup(input), changeIndex, decision),
  );
}

export function resolveCriticMarkupChangeNodes(
  nodes: readonly CriticMarkupNode[],
  changeIndex: number,
  decision: CriticMarkupChangeDecision,
): CriticMarkupNode[] {
  const changes = listCriticMarkupChanges(nodes);
  const change = changes[changeIndex];
  if (change === undefined) {
    throw new RangeError(`No CriticMarkup change exists at index ${changeIndex}`);
  }

  const nextNodes = nodes.slice();
  const node = nextNodes[change.nodeIndex];
  if (node === undefined) {
    throw new RangeError(`No CriticMarkup node exists at index ${change.nodeIndex}`);
  }

  const replacement = resolvedNodeText(node, decision);
  if (replacement === '') {
    nextNodes.splice(change.nodeIndex, 1);
  } else {
    nextNodes.splice(change.nodeIndex, 1, {type: 'text', value: replacement});
  }

  return mergeAdjacentTextNodes(nextNodes);
}

function serializeNode(node: CriticMarkupNode): string {
  switch (node.type) {
    case 'text':
      return escapeCriticMarkup(node.value);
    case 'addition':
      return `{++${escapeCriticMarkup(node.value)}++}`;
    case 'deletion':
      return `{--${escapeCriticMarkup(node.value)}--}`;
    case 'substitution':
      return `{~~${escapeCriticMarkup(node.oldValue)}~>${escapeCriticMarkup(node.newValue)}~~}`;
    case 'comment':
      return `{>>${escapeCriticMarkup(node.value)}<<}`;
    case 'highlight':
      return `{==${escapeCriticMarkup(node.value)}==}`;
  }
}

function appendChangedLines(
  outputLines: string[],
  beforeLines: readonly string[],
  afterLines: readonly string[],
): void {
  const pairCount = Math.min(beforeLines.length, afterLines.length);

  for (let index = 0; index < pairCount; index += 1) {
    const beforeLine = beforeLines[index] ?? '';
    const afterLine = afterLines[index] ?? '';
    outputLines.push(renderInlineChange(beforeLine, afterLine));
  }

  for (let index = pairCount; index < beforeLines.length; index += 1) {
    outputLines.push(serializeCriticMarkup([{type: 'deletion', value: beforeLines[index] ?? ''}]));
  }

  for (let index = pairCount; index < afterLines.length; index += 1) {
    outputLines.push(serializeCriticMarkup([{type: 'addition', value: afterLines[index] ?? ''}]));
  }
}

function renderInlineChange(beforeLine: string, afterLine: string): string {
  if (beforeLine === afterLine) {
    return beforeLine;
  }

  const beforeTokens = tokenizeInlineMarkdown(beforeLine);
  const afterTokens = tokenizeInlineMarkdown(afterLine);
  const prefixLength = commonPrefixLength(beforeTokens, afterTokens);
  const prefix = beforeTokens.slice(0, prefixLength).join('');
  const beforeRest = beforeTokens.slice(prefixLength);
  const afterRest = afterTokens.slice(prefixLength);

  if (beforeRest.length === 0) {
    return prefix + serializeCriticMarkup([{type: 'addition', value: afterRest.join('')}]);
  }

  if (afterRest.length === 0) {
    return prefix + serializeCriticMarkup([{type: 'deletion', value: beforeRest.join('')}]);
  }

  if (endsWithTokens(afterRest, beforeRest)) {
    const addedTokens = afterRest.slice(0, afterRest.length - beforeRest.length);
    return (
      prefix +
      serializeCriticMarkup([{type: 'addition', value: addedTokens.join('')}]) +
      beforeRest.join('')
    );
  }

  if (endsWithTokens(beforeRest, afterRest)) {
    const deletedTokens = beforeRest.slice(0, beforeRest.length - afterRest.length);
    return (
      prefix +
      serializeCriticMarkup([{type: 'deletion', value: deletedTokens.join('')}]) +
      afterRest.join('')
    );
  }

  return (
    prefix +
    serializeCriticMarkup([
      {
        type: 'substitution',
        oldValue: beforeRest.join(''),
        newValue: afterRest.join(''),
      },
    ])
  );
}

function lineMatches(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): Array<{beforeIndex: number; afterIndex: number}> {
  const rowCount = beforeLines.length + 1;
  const columnCount = afterLines.length + 1;
  const lengths: number[][] = Array.from({length: rowCount}, () =>
    Array.from({length: columnCount}, () => 0),
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
        lengths[beforeIndex]![afterIndex] = (lengths[beforeIndex + 1]?.[afterIndex + 1] ?? 0) + 1;
      } else {
        lengths[beforeIndex]![afterIndex] = Math.max(
          lengths[beforeIndex + 1]?.[afterIndex] ?? 0,
          lengths[beforeIndex]?.[afterIndex + 1] ?? 0,
        );
      }
    }
  }

  const matches: Array<{beforeIndex: number; afterIndex: number}> = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      matches.push({beforeIndex, afterIndex});
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      (lengths[beforeIndex + 1]?.[afterIndex] ?? 0) >=
      (lengths[beforeIndex]?.[afterIndex + 1] ?? 0)
    ) {
      beforeIndex += 1;
    } else {
      afterIndex += 1;
    }
  }

  return matches;
}

function tokenizeInlineMarkdown(value: string): string[] {
  const tokens: string[] = [];
  const tokenPattern =
    /(\*\*|__|`+|!\[|\]\(|[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|\s+|.)/gy;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value)) !== null) {
    tokens.push(match[0]);
  }

  return tokens;
}

function commonPrefixLength(beforeTokens: readonly string[], afterTokens: readonly string[]): number {
  const maxLength = Math.min(beforeTokens.length, afterTokens.length);
  let index = 0;
  while (index < maxLength && beforeTokens[index] === afterTokens[index]) {
    index += 1;
  }
  return index;
}

function endsWithTokens(tokens: readonly string[], suffix: readonly string[]): boolean {
  if (suffix.length > tokens.length) {
    return false;
  }

  const offset = tokens.length - suffix.length;
  for (let index = 0; index < suffix.length; index += 1) {
    if (tokens[offset + index] !== suffix[index]) {
      return false;
    }
  }
  return true;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function pushNode(nodes: CriticMarkupNode[], node: CriticMarkupNode): void {
  const previous = nodes[nodes.length - 1];
  if (previous?.type === 'text' && node.type === 'text') {
    previous.value += node.value;
    return;
  }
  nodes.push(node);
}

function resolvedNodeText(
  node: CriticMarkupNode,
  decision: CriticMarkupChangeDecision,
): string {
  switch (node.type) {
    case 'addition':
      return decision === 'accept' ? node.value : '';
    case 'deletion':
      return decision === 'accept' ? '' : node.value;
    case 'substitution':
      return decision === 'accept' ? node.newValue : node.oldValue;
    case 'comment':
    case 'highlight':
    case 'text':
      throw new TypeError(`Cannot resolve non-change CriticMarkup node "${node.type}"`);
  }
}

function mergeAdjacentTextNodes(nodes: readonly CriticMarkupNode[]): CriticMarkupNode[] {
  const mergedNodes: CriticMarkupNode[] = [];
  for (const node of nodes) {
    pushNode(mergedNodes, node);
  }
  return mergedNodes;
}

function findUnescaped(
  input: string,
  token: string,
  start: number,
  end = input.length,
): number {
  let index = start;
  while (index < end) {
    const foundIndex = input.indexOf(token, index);
    if (foundIndex === -1 || foundIndex >= end) {
      return -1;
    }
    if (!isEscaped(input, foundIndex)) {
      return foundIndex;
    }
    index = foundIndex + token.length;
  }
  return -1;
}

function isEscaped(input: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function escapeCriticMarkup(value: string): string {
  let escaped = value.replace(/\\/g, '\\\\');
  for (const token of ESCAPABLE_TOKENS) {
    escaped = escaped.replaceAll(token, `\\${token}`);
  }
  return escaped;
}

function unescapeCriticMarkup(value: string): string {
  let unescaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];
    if (char === '\\' && nextChar !== undefined) {
      unescaped += nextChar;
      index += 1;
    } else {
      unescaped += char;
    }
  }
  return unescaped;
}
