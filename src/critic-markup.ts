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

function pushNode(nodes: CriticMarkupNode[], node: CriticMarkupNode): void {
  const previous = nodes[nodes.length - 1];
  if (previous?.type === 'text' && node.type === 'text') {
    previous.value += node.value;
    return;
  }
  nodes.push(node);
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
