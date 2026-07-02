import {createEmptyHistoryState, registerHistory} from '@lexical/history';
import {registerRichText} from '@lexical/rich-text';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  ElementNode,
  TEXT_TYPE_TO_FORMAT,
  TextNode,
  mergeRegister,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type SerializedTextNode,
  type Spread,
  type TextFormatType,
} from 'lexical';

import {
  type ReviewComment,
  type ReviewHighlight,
  type ReviewModel,
  type ReviewRange,
  type ReviewSuggestion,
} from '../../src/index';

export type ReviewLexicalAdapter = {
  applyMarkdownFormat(command: ReviewMarkdownFormatCommand): void;
  dispose(): void;
  focus(): void;
  getModel(): ReviewModel;
  getSelectionOffset(): number | null;
  readSelectionRange(): ReviewRange | null;
  restoreSelectionOffset(offset: number | null): void;
  setEditable(editable: boolean): void;
  setModel(model: ReviewModel, mode: ReviewContentMode): void;
};

export type ReviewLexicalAdapterOptions = {
  onChange(model: ReviewModel, selectionOffset: number | null): void;
};

export type ReviewContentMode = 'source' | 'wysiwyg';

export type ReviewMarkdownFormatAction = 'block' | 'inline' | 'line';

export type ReviewMarkdownFormatCommand = {
  readonly action: ReviewMarkdownFormatAction;
  readonly mode: ReviewContentMode;
  readonly placeholder?: string;
  readonly prefix: string;
  readonly richFormat?: TextFormatType;
  readonly suffix: string;
};

type ReviewLexicalSnapshot = {
  readonly model: ReviewModel;
  readonly selectionOffset: number | null;
};

type ReviewSuggestionMeta = {
  changeIndex: number;
  id: string;
  part: 'new' | 'old';
  type: ReviewSuggestion['type'];
};

type ReviewCommentMeta = {
  id: string;
  value: string;
};

type ReviewTextMeta = {
  comment?: ReviewCommentMeta;
  highlightId?: string;
  suggestion?: ReviewSuggestionMeta;
};

type SerializedReviewTextNode = Spread<
  {
    review?: ReviewTextMeta;
  },
  SerializedTextNode
>;

type SerializedReviewCommentAnchorNode = Spread<
  {
    commentId: string;
    value: string;
  },
  SerializedElementNode
>;

type MutableSuggestion = {
  id: string;
  newRange?: ReviewRange;
  oldRange?: ReviewRange;
  type: ReviewSuggestion['type'];
};

class ReviewTextNode extends TextNode {
  __review: ReviewTextMeta | null;

  static override getType(): string {
    return 'review-text';
  }

  static override clone(node: ReviewTextNode): ReviewTextNode {
    return new ReviewTextNode(node.__text, cloneReviewTextMeta(node.__review), node.__key);
  }

  static override importJSON(serializedNode: SerializedReviewTextNode): ReviewTextNode {
    return $createReviewTextNode(serializedNode.text, serializedNode.review).updateFromJSON(
      serializedNode,
    );
  }

  constructor(text = '', review: ReviewTextMeta | null = null, key?: NodeKey) {
    super(text, key);
    this.__review = cloneReviewTextMeta(review);
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__review = cloneReviewTextMeta(prevNode.__review);
  }

  getReviewMeta(): ReviewTextMeta | null {
    return this.getLatest().__review;
  }

  setReviewMeta(review: ReviewTextMeta | null): this {
    const self = this.getWritable();
    self.__review = cloneReviewTextMeta(review);
    return self;
  }

  override createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const baseElement = super.createDOM(config, editor);
    const tagName = reviewTextTag(this.__review);
    const element = retagElement(baseElement, tagName);
    applyReviewTextDom(element, this.__review);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    if (reviewTextTag(prevNode.__review) !== reviewTextTag(this.__review)) {
      return true;
    }

    super.updateDOM(prevNode, dom, config);
    applyReviewTextDom(dom, this.__review);
    return false;
  }

  override exportJSON(): SerializedReviewTextNode {
    const serialized = {
      ...super.exportJSON(),
      type: ReviewTextNode.getType(),
      version: 1,
    };
    if (this.__review === null) {
      return serialized;
    }
    return {
      ...serialized,
      review: this.__review,
    };
  }

  override updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedReviewTextNode>): this {
    super.updateFromJSON(serializedNode);
    return this.setReviewMeta(serializedNode.review ?? null);
  }
}

class ReviewCommentAnchorNode extends ElementNode {
  __commentId: string;
  __value: string;

  static override getType(): string {
    return 'review-comment-anchor';
  }

  static override clone(node: ReviewCommentAnchorNode): ReviewCommentAnchorNode {
    return new ReviewCommentAnchorNode(node.__commentId, node.__value, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedReviewCommentAnchorNode,
  ): ReviewCommentAnchorNode {
    return $createReviewCommentAnchorNode(
      serializedNode.commentId,
      serializedNode.value,
    ).updateFromJSON(serializedNode);
  }

  constructor(commentId: string, value: string, key?: NodeKey) {
    super(key);
    this.__commentId = commentId;
    this.__value = value;
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__commentId = prevNode.__commentId;
    this.__value = prevNode.__value;
  }

  getComment(): ReviewCommentMeta {
    const self = this.getLatest();
    return {id: self.__commentId, value: self.__value};
  }

  override createDOM(): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.innerHTML = commentIconSvg();
    applyPointCommentDom(element, this.__commentId, this.__value);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (prevNode.__commentId !== this.__commentId || prevNode.__value !== this.__value) {
      applyPointCommentDom(dom, this.__commentId, this.__value);
    }
    return false;
  }

  override exportJSON(): SerializedReviewCommentAnchorNode {
    return {
      ...super.exportJSON(),
      commentId: this.__commentId,
      type: ReviewCommentAnchorNode.getType(),
      value: this.__value,
      version: 1,
    };
  }

  override getTextContent(): string {
    return '';
  }

  override isInline(): true {
    return true;
  }

  override canBeEmpty(): true {
    return true;
  }
}

export function createReviewLexicalAdapter(
  rootElement: HTMLElement,
  options: ReviewLexicalAdapterOptions,
): ReviewLexicalAdapter {
  let currentModel = emptyReviewModel();
  let currentMode: ReviewContentMode = 'wysiwyg';
  let applyingModel = false;

  const editor = createEditor({
    namespace: 'review2-demo',
    nodes: [ReviewTextNode, ReviewCommentAnchorNode],
    onError(error) {
      throw error;
    },
    theme: {
      root: 'review-lexical-root',
    },
  });

  editor.setRootElement(rootElement);
  rootElement.dataset.editorEngine = 'lexical';
  rootElement.contentEditable = 'true';

  const cleanup = mergeRegister(
    registerRichText(editor),
    registerHistory(editor, createEmptyHistoryState(), 300),
    editor.registerUpdateListener(({dirtyElements, dirtyLeaves, editorState}) => {
      if (applyingModel || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) {
        return;
      }

      const snapshot = editorStateToReviewSnapshot(editorState, currentMode);
      currentModel = snapshot.model;
      options.onChange(cloneReviewModel(currentModel), snapshot.selectionOffset);
    }),
  );

  return {
    applyMarkdownFormat(command: ReviewMarkdownFormatCommand) {
      editor.update(
        () => {
          applyMarkdownFormatToSelection(command);
        },
        {discrete: true},
      );
    },
    dispose() {
      cleanup();
      editor.setRootElement(null);
    },
    focus() {
      editor.focus();
    },
    getModel() {
      return cloneReviewModel(currentModel);
    },
    getSelectionOffset() {
      const range = readDomSelectionRange(rootElement);
      return range === null || range.start !== range.end ? null : range.start;
    },
    readSelectionRange() {
      return readDomSelectionRange(rootElement);
    },
    restoreSelectionOffset(offset: number | null) {
      if (offset === null) {
        return;
      }
      rootElement.focus();
      editor.update(
        () => {
          selectLexicalOffset(offset);
        },
        {discrete: true},
      );
    },
    setEditable(editable: boolean) {
      editor.setEditable(editable);
      rootElement.contentEditable = String(editable);
      rootElement.setAttribute('aria-readonly', String(!editable));
    },
    setModel(model: ReviewModel, mode: ReviewContentMode) {
      applyingModel = true;
      currentModel = cloneReviewModel(model);
      currentMode = mode;
      editor.update(
        () => {
          writeReviewModelToLexical(model, mode);
        },
        {discrete: true},
      );
      applyingModel = false;
    },
  };
}

function writeReviewModelToLexical(model: ReviewModel, mode: ReviewContentMode): void {
  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  const boundaries = modelBoundaries(model);
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined) {
      continue;
    }

    for (const comment of pointCommentsAt(model, start)) {
      paragraph.append($createReviewCommentAnchorNode(comment.id, comment.value));
    }

    if (end === undefined || end === start) {
      continue;
    }

    appendTextWithLineBreaks(
      paragraph,
      model.text.slice(start, end),
      metaForRange(model, {start, end}),
      mode,
    );
  }

  root.append(paragraph);
}

function appendTextWithLineBreaks(
  paragraph: ReturnType<typeof $createParagraphNode>,
  value: string,
  meta: ReviewTextMeta | null,
  mode: ReviewContentMode,
): void {
  const lines = value.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length > 0) {
      appendTextLine(paragraph, line, meta, mode);
    }
    if (index < lines.length - 1) {
      paragraph.append($createLineBreakNode());
    }
  }
}

function appendTextLine(
  paragraph: ReturnType<typeof $createParagraphNode>,
  line: string,
  meta: ReviewTextMeta | null,
  mode: ReviewContentMode,
): void {
  if (mode === 'source') {
    paragraph.append(meta === null ? $createTextNode(line) : $createReviewTextNode(line, meta));
    return;
  }

  for (const segment of parseMarkdownInline(line)) {
    if (segment.text.length === 0) {
      continue;
    }

    const node = meta === null
      ? $createTextNode(segment.text)
      : $createReviewTextNode(segment.text, meta);
    node.setFormat(segment.format);
    paragraph.append(node);
  }
}

type MarkdownInlineSegment = {
  readonly format: number;
  readonly text: string;
};

type MarkdownDelimiter = {
  readonly close: string;
  readonly format: number;
  readonly open: string;
};

const markdownInlineDelimiters: readonly MarkdownDelimiter[] = [
  {close: '`', format: markdownFormatFlag('code'), open: '`'},
  {close: '**', format: markdownFormatFlag('bold'), open: '**'},
  {close: '~~', format: markdownFormatFlag('strikethrough'), open: '~~'},
  {close: '*', format: markdownFormatFlag('italic'), open: '*'},
];

function markdownFormatFlag(format: TextFormatType): number {
  const flag = TEXT_TYPE_TO_FORMAT[format];
  if (flag === undefined) {
    throw new Error(`Unsupported text format: ${format}`);
  }
  return flag;
}

function parseMarkdownInline(value: string, inheritedFormat = 0): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const match = nextMarkdownDelimiter(value, cursor);
    if (match === null) {
      segments.push({format: inheritedFormat, text: value.slice(cursor)});
      break;
    }

    if (match.start > cursor) {
      segments.push({format: inheritedFormat, text: value.slice(cursor, match.start)});
    }

    const innerStart = match.start + match.delimiter.open.length;
    const innerEnd = match.end;
    const innerText = value.slice(innerStart, innerEnd);
    const nextFormat = inheritedFormat | match.delimiter.format;
    if (match.delimiter.format === TEXT_TYPE_TO_FORMAT.code) {
      segments.push({format: nextFormat, text: innerText});
    } else {
      segments.push(...parseMarkdownInline(innerText, nextFormat));
    }
    cursor = match.end + match.delimiter.close.length;
  }

  return segments.filter(segment => segment.text.length > 0);
}

function nextMarkdownDelimiter(
  value: string,
  startOffset: number,
): {delimiter: MarkdownDelimiter; end: number; start: number} | null {
  let best: {delimiter: MarkdownDelimiter; end: number; start: number} | null = null;
  for (const delimiter of markdownInlineDelimiters) {
    const start = value.indexOf(delimiter.open, startOffset);
    if (start === -1) {
      continue;
    }

    const end = value.indexOf(delimiter.close, start + delimiter.open.length);
    if (end === -1) {
      continue;
    }

    if (best === null || start < best.start) {
      best = {delimiter, end, start};
    }
  }
  return best;
}

function editorStateToReviewSnapshot(
  editorState: EditorState,
  mode: ReviewContentMode,
): ReviewLexicalSnapshot {
  return editorState.read(() => {
    const suggestions = new Map<string, MutableSuggestion>();
    const comments = new Map<string, ReviewComment>();
    const highlights = new Map<string, ReviewHighlight>();
    let text = '';
    let selectionOffset: number | null = null;
    const selectionPoint = collapsedSelectionPoint();

    const appendText = (value: string): ReviewRange => {
      const start = text.length;
      text += value;
      return {end: text.length, start};
    };

    const appendNode = (node: LexicalNode): void => {
      if (selectionPoint !== null && selectionPoint.key === node.getKey()) {
        selectionOffset = text.length + offsetInsideSelectionNode(node, selectionPoint.offset);
      }

      if ($isReviewCommentAnchorNode(node)) {
        const comment = node.getComment();
        comments.set(comment.id, {
          end: text.length,
          id: comment.id,
          start: text.length,
          value: comment.value,
        });
        return;
      }

      if ($isReviewTextNode(node)) {
        const range = appendText(serializeLexicalTextNode(node, mode));
        applyReviewMetaToModel(node.getReviewMeta(), range, suggestions, comments, highlights);
        return;
      }

      if ($isTextNode(node)) {
        appendText(serializeLexicalTextNode(node, mode));
        return;
      }

      if ($isLineBreakNode(node)) {
        appendText(node.getTextContent());
        return;
      }

      if ($isElementNode(node)) {
        for (const child of node.getChildren()) {
          appendNode(child);
        }
      }
    };

    const root = $getRoot();
    const children = root.getChildren();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined) {
        continue;
      }
      if (index > 0 && $isElementNode(child) && !child.isInline()) {
        appendText('\n\n');
      }
      appendNode(child);
    }

    return {
      model: {
      comments: Array.from(comments.values()).sort(compareRanges),
      highlights: Array.from(highlights.values()).sort(compareRanges),
      suggestions: Array.from(suggestions.values())
        .filter(hasSuggestionRange)
        .map(toReviewSuggestion)
        .sort((left, right) => suggestionModelStart(left) - suggestionModelStart(right)),
      text,
      },
      selectionOffset,
    };
  });
}

function collapsedSelectionPoint(): {key: string; offset: number} | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }

  return {
    key: selection.anchor.key,
    offset: selection.anchor.offset,
  };
}

function serializeLexicalTextNode(node: TextNode, mode: ReviewContentMode): string {
  const text = node.getTextContent();
  if (mode === 'source' || text.length === 0) {
    return text;
  }

  if (node.hasFormat('code')) {
    return `\`${text}\``;
  }

  let output = text;
  if (node.hasFormat('bold')) {
    output = `**${output}**`;
  }
  if (node.hasFormat('italic')) {
    output = `*${output}*`;
  }
  if (node.hasFormat('strikethrough')) {
    output = `~~${output}~~`;
  }
  return output;
}

function offsetInsideSelectionNode(node: LexicalNode, offset: number): number {
  if ($isTextNode(node)) {
    return Math.min(offset, node.getTextContent().length);
  }

  if ($isLineBreakNode(node)) {
    return Math.min(offset, 1);
  }

  if (!$isElementNode(node)) {
    return 0;
  }

  return node
    .getChildren()
    .slice(0, offset)
    .reduce((total, child) => total + child.getTextContent().length, 0);
}

function applyMarkdownFormatToSelection(command: ReviewMarkdownFormatCommand): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }

  if (
    command.mode === 'wysiwyg' &&
    command.action === 'inline' &&
    command.richFormat !== undefined
  ) {
    selection.formatText(command.richFormat);
    return;
  }

  const range = selectionRangeOffset(selection);
  const rawSelectedText = selection.getTextContent();
  const selectedText = rawSelectedText || command.placeholder || '';
  const formattedText = markdownFormattedText(command, selectedText);
  selection.insertText(formattedText);

  if (range === null) {
    return;
  }

  const nextOffset = rawSelectedText.length === 0
    ? range.start + command.prefix.length
    : range.start + formattedText.length;
  selectLexicalOffset(nextOffset);
}

function markdownFormattedText(command: ReviewMarkdownFormatCommand, selectedText: string): string {
  if (command.action === 'line') {
    const lines = selectedText.split('\n');
    return lines.map((line, index) => {
      const prefix = command.prefix.includes('{n}')
        ? command.prefix.replace('{n}', String(index + 1))
        : command.prefix;
      return `${prefix}${line}`;
    }).join('\n');
  }

  if (command.action === 'block') {
    return `${command.prefix}${selectedText}${command.suffix}`;
  }

  return `${command.prefix}${selectedText}${command.suffix}`;
}

function selectionRangeOffset(selection: ReturnType<typeof $getSelection>): ReviewRange | null {
  if (!$isRangeSelection(selection)) {
    return null;
  }

  const anchorOffset = offsetForLexicalPoint(selection.anchor.key, selection.anchor.offset);
  const focusOffset = offsetForLexicalPoint(selection.focus.key, selection.focus.offset);
  if (anchorOffset === null || focusOffset === null) {
    return null;
  }

  return anchorOffset <= focusOffset
    ? {end: focusOffset, start: anchorOffset}
    : {end: anchorOffset, start: focusOffset};
}

function offsetForLexicalPoint(key: string, offset: number): number | null {
  const root = $getRoot();
  if (root.getKey() === key) {
    return offsetInsideSelectionNode(root, offset);
  }

  let textOffset = 0;
  let match: number | null = null;

  const visit = (node: LexicalNode): void => {
    if (match !== null) {
      return;
    }

    if (node.getKey() === key) {
      match = textOffset + offsetInsideSelectionNode(node, offset);
      return;
    }

    if ($isReviewCommentAnchorNode(node)) {
      return;
    }

    if ($isTextNode(node) || $isLineBreakNode(node)) {
      textOffset += node.getTextContent().length;
      return;
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  };

  for (const child of root.getChildren()) {
    visit(child);
  }

  return match;
}

function selectLexicalOffset(offset: number): void {
  let remaining = Math.max(0, offset);

  const visit = (node: LexicalNode): boolean => {
    if ($isReviewCommentAnchorNode(node)) {
      return false;
    }

    if ($isTextNode(node)) {
      const length = node.getTextContent().length;
      if (remaining <= length) {
        node.select(remaining, remaining);
        return true;
      }
      remaining -= length;
      return false;
    }

    if ($isLineBreakNode(node)) {
      if (remaining <= 1) {
        const parent = node.getParent();
        if (parent !== null) {
          parent.select(parent.getChildren().indexOf(node) + 1);
          return true;
        }
      }
      remaining -= 1;
      return false;
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        if (visit(child)) {
          return true;
        }
      }
    }

    return false;
  };

  const root = $getRoot();
  for (const child of root.getChildren()) {
    if (visit(child)) {
      return;
    }
  }

  root.selectEnd();
}

function applyReviewMetaToModel(
  meta: ReviewTextMeta | null,
  range: ReviewRange,
  suggestions: Map<string, MutableSuggestion>,
  comments: Map<string, ReviewComment>,
  highlights: Map<string, ReviewHighlight>,
): void {
  if (range.start === range.end || meta === null) {
    return;
  }

  if (meta.suggestion !== undefined) {
    const current = suggestions.get(meta.suggestion.id) ?? {
      id: meta.suggestion.id,
      type: meta.suggestion.type,
    };
    mergeSuggestionRange(current, meta.suggestion.part, range);
    suggestions.set(current.id, current);
  }

  if (meta.comment !== undefined) {
    const current = comments.get(meta.comment.id);
    comments.set(meta.comment.id, {
      end: current === undefined ? range.end : Math.max(current.end, range.end),
      id: meta.comment.id,
      start: current === undefined ? range.start : Math.min(current.start, range.start),
      value: meta.comment.value,
    });
  }

  if (meta.highlightId !== undefined) {
    const current = highlights.get(meta.highlightId);
    highlights.set(meta.highlightId, {
      end: current === undefined ? range.end : Math.max(current.end, range.end),
      id: meta.highlightId,
      start: current === undefined ? range.start : Math.min(current.start, range.start),
    });
  }
}

function metaForRange(model: ReviewModel, range: ReviewRange): ReviewTextMeta | null {
  const suggestionPart = suggestionPartForRange(model, range);
  const comment = model.comments.find(
    item => item.start !== item.end && item.start <= range.start && item.end >= range.end,
  );
  const highlight = model.highlights.find(
    item => item.start <= range.start && item.end >= range.end,
  );

  const meta: ReviewTextMeta = {};
  if (suggestionPart !== null) {
    meta.suggestion = {
      changeIndex: model.suggestions.findIndex(
        suggestion => suggestion.id === suggestionPart.suggestion.id,
      ),
      id: suggestionPart.suggestion.id,
      part: suggestionPart.part,
      type: suggestionPart.suggestion.type,
    };
  }
  if (comment !== undefined) {
    meta.comment = {id: comment.id, value: comment.value};
  }
  if (highlight !== undefined) {
    meta.highlightId = highlight.id;
  }

  return isEmptyReviewTextMeta(meta) ? null : meta;
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

function pointCommentsAt(model: ReviewModel, offset: number): ReviewComment[] {
  return model.comments.filter(comment => comment.start === offset && comment.end === offset);
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

function readDomSelectionRange(root: HTMLElement): ReviewRange | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!rootContainsBoundary(root, range.startContainer) || !rootContainsBoundary(root, range.endContainer)) {
    return null;
  }

  const start = offsetForDomBoundary(root, range.startContainer, range.startOffset);
  const end = offsetForDomBoundary(root, range.endContainer, range.endOffset);
  return start <= end ? {end, start} : {end: start, start: end};
}

function restoreDomSelectionOffset(root: HTMLElement, offset: number | null): void {
  if (offset === null) {
    return;
  }

  const position = findDomPositionAtOffset(root, offset);
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  root.focus();

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function offsetForDomBoundary(root: HTMLElement, container: Node, offset: number): number {
  let textOffset = 0;
  let found = false;

  const countNode = (node: Node): void => {
    if (found) {
      return;
    }

    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        textOffset += Math.min(offset, node.nodeValue?.length ?? 0);
      } else {
        for (const child of Array.from(node.childNodes).slice(0, offset)) {
          textOffset += textLengthOfDomNode(child);
        }
      }
      found = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      textOffset += node.nodeValue?.length ?? 0;
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.matches('.comment-anchor')) {
      return;
    }

    if (node.tagName === 'BR') {
      textOffset += 1;
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      countNode(child);
      if (found) {
        return;
      }
    }
  };

  countNode(root);
  return textOffset;
}

function findDomPositionAtOffset(root: HTMLElement, offset: number): {node: Node; offset: number} {
  let remaining = Math.max(0, offset);

  const childPosition = (node: Node, child: Node, adjustment = 0): {node: Node; offset: number} => ({
    node,
    offset: Array.prototype.indexOf.call(node.childNodes, child) + adjustment,
  });

  const visit = (node: Node): {node: Node; offset: number} | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (remaining <= length) {
        return {node, offset: remaining};
      }
      remaining -= length;
      return null;
    }

    if (!(node instanceof HTMLElement)) {
      return null;
    }

    if (node.matches('.comment-anchor')) {
      return null;
    }

    if (node.tagName === 'BR') {
      if (remaining <= 1 && node.parentNode !== null) {
        return childPosition(node.parentNode, node, 1);
      }
      remaining -= 1;
      return null;
    }

    for (const child of Array.from(node.childNodes)) {
      const position = visit(child);
      if (position !== null) {
        return position;
      }
    }

    return null;
  };

  for (const child of Array.from(root.childNodes)) {
    const position = visit(child);
    if (position !== null) {
      return position;
    }
  }

  return {node: root, offset: root.childNodes.length};
}

function textLengthOfDomNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue?.length ?? 0;
  }
  if (!(node instanceof HTMLElement) || node.matches('.comment-anchor')) {
    return 0;
  }
  if (node.tagName === 'BR') {
    return 1;
  }
  return Array.from(node.childNodes).reduce((total, child) => total + textLengthOfDomNode(child), 0);
}

function rootContainsBoundary(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
}

function reviewTextTag(meta: ReviewTextMeta | null): 'del' | 'ins' | 'mark' | 'span' {
  if (meta?.suggestion?.part === 'new') {
    return 'ins';
  }
  if (meta?.suggestion?.part === 'old') {
    return 'del';
  }
  if (meta?.comment !== undefined || meta?.highlightId !== undefined) {
    return 'mark';
  }
  return 'span';
}

function retagElement(element: HTMLElement, tagName: 'del' | 'ins' | 'mark' | 'span'): HTMLElement {
  if (element.tagName.toLowerCase() === tagName) {
    return element;
  }

  const replacement = document.createElement(tagName);
  while (element.firstChild !== null) {
    replacement.append(element.firstChild);
  }
  return replacement;
}

function applyReviewTextDom(element: HTMLElement, meta: ReviewTextMeta | null): void {
  element.classList.remove(
    'active-review-change',
    'review-addition',
    'review-change',
    'review-deletion',
    'review-highlight',
    'review-range-comment',
  );
  element.removeAttribute('data-change-index');
  element.removeAttribute('data-change-kind');
  element.removeAttribute('data-comment-id');
  element.removeAttribute('data-comment-value');
  element.removeAttribute('data-highlight-id');
  element.removeAttribute('data-suggestion-id');
  element.removeAttribute('data-suggestion-part');
  element.removeAttribute('data-testid');
  element.removeAttribute('tabindex');

  if (meta?.suggestion !== undefined) {
    element.classList.add('review-change');
    element.classList.add(meta.suggestion.part === 'new' ? 'review-addition' : 'review-deletion');
    element.dataset.changeIndex = String(meta.suggestion.changeIndex);
    element.dataset.changeKind = meta.suggestion.type;
    element.dataset.suggestionId = meta.suggestion.id;
    element.dataset.suggestionPart = meta.suggestion.part;
    element.tabIndex = 0;
  }

  if (meta?.comment !== undefined) {
    element.classList.add('review-range-comment');
    element.dataset.commentId = meta.comment.id;
    element.dataset.commentValue = meta.comment.value;
    element.dataset.testid = 'range-comment';
    element.tabIndex = 0;
  }

  if (meta?.highlightId !== undefined) {
    element.classList.add('review-highlight');
    element.dataset.highlightId = meta.highlightId;
  }
}

function applyPointCommentDom(element: HTMLElement, commentId: string, value: string): void {
  element.className = 'comment-anchor';
  element.dataset.commentId = commentId;
  element.dataset.commentValue = value;
  element.dataset.testid = 'comment-anchor';
  element.setAttribute('aria-label', 'Show comment');
  element.contentEditable = 'false';
}

function $createReviewTextNode(text: string, review: ReviewTextMeta | null = null): ReviewTextNode {
  return $applyNodeReplacement(new ReviewTextNode(text, review));
}

function $isReviewTextNode(node: LexicalNode | null | undefined): node is ReviewTextNode {
  return node instanceof ReviewTextNode;
}

function $createReviewCommentAnchorNode(commentId: string, value: string): ReviewCommentAnchorNode {
  return $applyNodeReplacement(new ReviewCommentAnchorNode(commentId, value));
}

function $isReviewCommentAnchorNode(
  node: LexicalNode | null | undefined,
): node is ReviewCommentAnchorNode {
  return node instanceof ReviewCommentAnchorNode;
}

function cloneReviewTextMeta(meta: ReviewTextMeta | null | undefined): ReviewTextMeta | null {
  if (meta === undefined || meta === null) {
    return null;
  }

  const clone: ReviewTextMeta = {};
  if (meta.comment !== undefined) {
    clone.comment = {...meta.comment};
  }
  if (meta.highlightId !== undefined) {
    clone.highlightId = meta.highlightId;
  }
  if (meta.suggestion !== undefined) {
    clone.suggestion = {...meta.suggestion};
  }
  return isEmptyReviewTextMeta(clone) ? null : clone;
}

function isEmptyReviewTextMeta(meta: ReviewTextMeta): boolean {
  return meta.comment === undefined && meta.highlightId === undefined && meta.suggestion === undefined;
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

function commentIconSvg(): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3V5Z"></path></svg>`;
}
