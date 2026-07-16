import {CodeNode, $createCodeNode, $isCodeNode} from '@lexical/code-core';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/extension';
import {createEmptyHistoryState, registerHistory} from '@lexical/history';
import {
  CHECK_LIST,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  TEXT_FORMAT_TRANSFORMERS,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
  UNORDERED_LIST,
  $convertFromMarkdownString,
  registerMarkdownShortcuts,
} from '@lexical/markdown';
import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  LinkNode,
} from '@lexical/link';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  $isListItemNode,
  $isListNode,
  registerCheckList,
  registerList,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
  type HeadingTagType,
} from '@lexical/rich-text';
import {$setBlocksType} from '@lexical/selection';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getRoot,
  $getSelection,
  $insertNodes,
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
  type SerializedLexicalNode,
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

export type ReviewRichBlockFormat =
  | 'check'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'hr'
  | 'ol'
  | 'quote'
  | 'ul';

export type ReviewMarkdownFormatCommand = {
  readonly action: ReviewMarkdownFormatAction;
  readonly mode: ReviewContentMode;
  readonly placeholder?: string;
  readonly prefix: string;
  readonly richBlock?: ReviewRichBlockFormat;
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

type SerializedReviewImageNode = Spread<
  {
    src: string;
    title?: string;
  },
  SerializedElementNode
>;

type MutableSuggestion = {
  id: string;
  newRange?: ReviewRange;
  oldRange?: ReviewRange;
  type: ReviewSuggestion['type'];
};

type ProjectedSuggestionMeta = ReviewSuggestionMeta & {
  range: ReviewRange;
};

type ProjectedCommentMeta = ReviewCommentMeta & {
  range: ReviewRange;
};

type ProjectedAnnotations = {
  readonly comments: readonly ProjectedCommentMeta[];
  readonly highlights: readonly (ReviewHighlight & {range: ReviewRange})[];
  readonly pointComments: readonly (ReviewCommentMeta & {offset: number})[];
  readonly suggestions: readonly ProjectedSuggestionMeta[];
};

type MarkdownSourceMap = {
  readonly displayText: string;
  readonly displayToSourceEnd: readonly number[];
  readonly displayToSourceStart: readonly number[];
  readonly sourceToDisplay: readonly number[];
};

const DOUBLE_LINE_BREAK = '\n\n';
const MARKDOWN_BOUNDARY_SENTINEL = '\uE000';

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
    const element = super.createDOM(config, editor);
    applyReviewTextDom(element, this.__review);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    if (super.updateDOM(prevNode, dom, config)) {
      return true;
    }
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

class ReviewImageNode extends ElementNode {
  __src: string;
  __title: string | null;

  static override getType(): string {
    return 'review-image';
  }

  static override clone(node: ReviewImageNode): ReviewImageNode {
    return new ReviewImageNode(node.__src, node.__title, node.__key);
  }

  static override importJSON(serializedNode: SerializedReviewImageNode): ReviewImageNode {
    return $createReviewImageNode(
      serializedNode.src,
      serializedNode.title ?? null,
    ).updateFromJSON(serializedNode);
  }

  constructor(src: string, title: string | null = null, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__title = title;
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__src = prevNode.__src;
    this.__title = prevNode.__title;
  }

  getImage(): {src: string; title: string | null} {
    const self = this.getLatest();
    return {src: self.__src, title: self.__title};
  }

  override createDOM(): HTMLElement {
    const element = document.createElement('span');
    applyReviewImageDom(element, this.__src, this.__title);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (prevNode.__src !== this.__src || prevNode.__title !== this.__title) {
      applyReviewImageDom(dom, this.__src, this.__title);
    }
    return false;
  }

  override exportJSON(): SerializedReviewImageNode {
    const serialized: SerializedReviewImageNode = {
      ...super.exportJSON(),
      src: this.__src,
      type: ReviewImageNode.getType(),
      version: 1,
    };
    if (this.__title !== null) {
      serialized.title = this.__title;
    }
    return serialized;
  }

  override isInline(): true {
    return true;
  }
}

const IMAGE: TextMatchTransformer = {
  dependencies: [ReviewImageNode],
  export: (node, exportChildren) => {
    if (!$isReviewImageNode(node)) {
      return null;
    }

    const {src, title} = node.getImage();
    const escapedTitle = title?.replace(/([\\"])/g, '\\$1');
    return escapedTitle === undefined || escapedTitle === null
      ? `![${exportChildren(node)}](${src})`
      : `![${exportChildren(node)}](${src} "${escapedTitle}")`;
  },
  importRegExp:
    /(?:!\[(.*?)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))/,
  regExp:
    /(?:!\[([^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))$/,
  replace: (textNode, match) => {
    const [, altText = '', src = '', title] = match;
    const imageNode = $createReviewImageNode(src, title ?? null);
    const altNode = $createTextNode(altText);
    altNode.setFormat(textNode.getFormat());
    imageNode.append(altNode);
    textNode.replace(imageNode);
    return altNode;
  },
  trigger: ')',
  type: 'text-match',
};

const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: node => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(?:-{3,}|\*{3,}|_{3,})\s*$/,
  replace: parentNode => {
    parentNode.replace($createHorizontalRuleNode());
  },
  type: 'element',
};

const REVIEW_MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  HORIZONTAL_RULE,
  CODE,
  INLINE_CODE,
  ...TEXT_FORMAT_TRANSFORMERS.filter(transformer => transformer !== INLINE_CODE),
  STRIKETHROUGH,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  IMAGE,
  LINK,
].filter((transformer, index, transformers) => transformers.indexOf(transformer) === index);

export function createReviewLexicalAdapter(
  rootElement: HTMLElement,
  options: ReviewLexicalAdapterOptions,
): ReviewLexicalAdapter {
  let currentModel = emptyReviewModel();
  let currentMode: ReviewContentMode = 'wysiwyg';
  let applyingModel = false;

  const editor = createEditor({
    namespace: 'review2-demo',
    nodes: [
      CodeNode,
      HeadingNode,
      HorizontalRuleNode,
      LinkNode,
      ListItemNode,
      ListNode,
      QuoteNode,
      ReviewCommentAnchorNode,
      ReviewImageNode,
      ReviewTextNode,
    ],
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
    registerList(editor),
    registerCheckList(editor),
    registerMarkdownShortcuts(editor, REVIEW_MARKDOWN_TRANSFORMERS),
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
  if (mode === 'wysiwyg') {
    writeWysiwygReviewModelToLexical(model);
    return;
  }

  writeSourceReviewModelToLexical(model);
}

function writeSourceReviewModelToLexical(model: ReviewModel): void {
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
    );
  }

  root.append(paragraph);
}

function writeWysiwygReviewModelToLexical(model: ReviewModel): void {
  const boundaries = modelBoundaries(model);
  const sourceMap = createMarkdownSourceMap(model.text, boundaries);
  const projected = projectReviewAnnotations(model, sourceMap);
  const importText = insertMarkdownBoundarySentinels(model.text, boundaries);

  $convertFromMarkdownString(importText, REVIEW_MARKDOWN_TRANSFORMERS);
  removeMarkdownBoundarySentinels();
  applyProjectedReviewAnnotations(projected);
}

function appendTextWithLineBreaks(
  paragraph: ReturnType<typeof $createParagraphNode>,
  value: string,
  meta: ReviewTextMeta | null,
): void {
  const lines = value.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length > 0) {
      paragraph.append(meta === null ? $createTextNode(line) : $createReviewTextNode(line, meta));
    }
    if (index < lines.length - 1) {
      paragraph.append($createLineBreakNode());
    }
  }
}

function projectReviewAnnotations(
  model: ReviewModel,
  sourceMap: MarkdownSourceMap,
): ProjectedAnnotations {
  const suggestions: ProjectedSuggestionMeta[] = [];
  const comments: ProjectedCommentMeta[] = [];
  const pointComments: (ReviewCommentMeta & {offset: number})[] = [];
  const highlights: (ReviewHighlight & {range: ReviewRange})[] = [];

  for (const suggestion of model.suggestions) {
    const changeIndex = model.suggestions.findIndex(item => item.id === suggestion.id);
    const pushSuggestion = (part: 'new' | 'old', sourceRange: ReviewRange | undefined): void => {
      if (sourceRange === undefined) {
        return;
      }
      const range = sourceRangeToDisplayRange(sourceMap, sourceRange);
      if (range.start === range.end) {
        return;
      }
      suggestions.push({
        changeIndex,
        id: suggestion.id,
        part,
        range,
        type: suggestion.type,
      });
    };
    pushSuggestion('old', suggestion.oldRange);
    pushSuggestion('new', suggestion.newRange);
  }

  for (const comment of model.comments) {
    if (comment.start === comment.end) {
      pointComments.push({
        id: comment.id,
        offset: sourceOffsetToDisplayOffset(sourceMap, comment.start),
        value: comment.value,
      });
      continue;
    }
    const range = sourceRangeToDisplayRange(sourceMap, comment);
    if (range.start !== range.end) {
      comments.push({id: comment.id, range, value: comment.value});
    }
  }

  for (const highlight of model.highlights) {
    const range = sourceRangeToDisplayRange(sourceMap, highlight);
    if (range.start !== range.end) {
      highlights.push({...highlight, range});
    }
  }

  return {comments, highlights, pointComments, suggestions};
}

function applyProjectedReviewAnnotations(projected: ProjectedAnnotations): void {
  splitTextNodesForProjectedAnnotations(projected);
  for (const comment of projected.pointComments) {
    insertPointCommentAtDisplayOffset(comment);
  }
}

function splitTextNodesForProjectedAnnotations(projected: ProjectedAnnotations): void {
  for (const {end, node, start} of collectTextNodeDisplayRanges()) {
    if (!node.isAttached()) {
      continue;
    }

    const text = node.getTextContent();
    if (text.length === 0) {
      continue;
    }

    const splitOffsets = annotationBoundariesForRange(projected, {start, end})
      .map(boundary => boundary - start)
      .filter(boundary => boundary > 0 && boundary < text.length);
    const uniqueSplitOffsets = Array.from(new Set(splitOffsets)).sort((left, right) => left - right);
    const parts = uniqueSplitOffsets.length === 0 ? [node] : node.splitText(...uniqueSplitOffsets);

    let partStart = start;
    for (const part of parts) {
      const partText = part.getTextContent();
      const partEnd = partStart + partText.length;
      const meta = metaForProjectedDisplayRange(projected, {start: partStart, end: partEnd});
      if (meta !== null || $isReviewTextNode(part)) {
        const replacement = $createReviewTextNode(partText, meta);
        copyTextNodePresentation(part, replacement);
        part.replace(replacement);
      }
      partStart = partEnd;
    }
  }
}

function collectTextNodeDisplayRanges(): {end: number; node: TextNode; start: number}[] {
  const ranges: {end: number; node: TextNode; start: number}[] = [];
  let offset = 0;

  const visit = (node: LexicalNode): void => {
    if ($isReviewCommentAnchorNode(node)) {
      return;
    }
    if ($isTextNode(node)) {
      const start = offset;
      offset += node.getTextContent().length;
      ranges.push({end: offset, node, start});
      return;
    }
    if ($isLineBreakNode(node)) {
      offset += 1;
      return;
    }
    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child === undefined) {
          continue;
        }
        visit(child);
        if ($isElementNode(child) && !child.isInline() && index !== children.length - 1) {
          offset += DOUBLE_LINE_BREAK.length;
        }
      }
    }
  };

  visit($getRoot());
  return ranges;
}

function annotationBoundariesForRange(
  projected: ProjectedAnnotations,
  range: ReviewRange,
): number[] {
  const boundaries: number[] = [];
  const addBoundary = (boundary: number): void => {
    if (boundary > range.start && boundary < range.end) {
      boundaries.push(boundary);
    }
  };
  for (const suggestion of projected.suggestions) {
    addBoundary(suggestion.range.start);
    addBoundary(suggestion.range.end);
  }
  for (const comment of projected.comments) {
    addBoundary(comment.range.start);
    addBoundary(comment.range.end);
  }
  for (const highlight of projected.highlights) {
    addBoundary(highlight.range.start);
    addBoundary(highlight.range.end);
  }
  return boundaries;
}

function metaForProjectedDisplayRange(
  projected: ProjectedAnnotations,
  range: ReviewRange,
): ReviewTextMeta | null {
  const suggestion = projected.suggestions.find(item => rangeContains(item.range, range));
  const comment = projected.comments.find(item => rangeContains(item.range, range));
  const highlight = projected.highlights.find(item => rangeContains(item.range, range));
  const meta: ReviewTextMeta = {};

  if (suggestion !== undefined) {
    meta.suggestion = {
      changeIndex: suggestion.changeIndex,
      id: suggestion.id,
      part: suggestion.part,
      type: suggestion.type,
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

function copyTextNodePresentation(source: TextNode, target: TextNode): void {
  target.setFormat(source.getFormat());
  target.setDetail(source.getDetail());
  target.setStyle(source.getStyle());
}

function insertPointCommentAtDisplayOffset(comment: ReviewCommentMeta & {offset: number}): void {
  let offset = Math.max(0, comment.offset);
  const root = $getRoot();

  const visit = (node: LexicalNode): boolean => {
    if ($isReviewCommentAnchorNode(node)) {
      return false;
    }

    if ($isTextNode(node)) {
      const textLength = node.getTextContent().length;
      if (offset === 0) {
        node.insertBefore($createReviewCommentAnchorNode(comment.id, comment.value));
        return true;
      }
      if (offset < textLength) {
        const [, right] = node.splitText(offset);
        if (right === undefined) {
          return false;
        }
        right.insertBefore($createReviewCommentAnchorNode(comment.id, comment.value));
        return true;
      }
      if (offset === textLength) {
        node.insertAfter($createReviewCommentAnchorNode(comment.id, comment.value));
        return true;
      }
      offset -= textLength;
      return false;
    }

    if ($isLineBreakNode(node)) {
      if (offset <= 1) {
        node.insertAfter($createReviewCommentAnchorNode(comment.id, comment.value));
        return true;
      }
      offset -= 1;
      return false;
    }

    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child !== undefined && visit(child)) {
          return true;
        }
        if (child !== undefined && $isElementNode(child) && !child.isInline() && index !== children.length - 1) {
          if (offset <= DOUBLE_LINE_BREAK.length) {
            child.insertAfter($createReviewCommentAnchorNode(comment.id, comment.value));
            return true;
          }
          offset -= DOUBLE_LINE_BREAK.length;
        }
      }
    }

    return false;
  };

  if (!visit(root)) {
    const lastChild = root.getLastChild();
    if ($isElementNode(lastChild)) {
      lastChild.append($createReviewCommentAnchorNode(comment.id, comment.value));
      return;
    }
    const paragraph = $createParagraphNode();
    paragraph.append($createReviewCommentAnchorNode(comment.id, comment.value));
    root.append(paragraph);
  }
}

function editorStateToReviewSnapshot(
  editorState: EditorState,
  mode: ReviewContentMode,
): ReviewLexicalSnapshot {
  return editorState.read(() => {
    if (mode === 'wysiwyg') {
      return wysiwygEditorStateToReviewSnapshot();
    }

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

function wysiwygEditorStateToReviewSnapshot(): ReviewLexicalSnapshot {
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

    if ($isReviewImageNode(node)) {
      const {src, title} = node.getImage();
      appendText('![');
      appendElementChildren(node);
      appendText(title === null ? `](${src})` : `](${src} "${title.replace(/([\\"])/g, '\\$1')}")`);
      return;
    }

    if ($isLinkNode(node) && !$isAutoLinkNode(node)) {
      appendText('[');
      appendElementChildren(node);
      const title = node.getTitle();
      appendText(title === null
        ? `](${node.getURL()})`
        : `](${node.getURL()} "${title.replace(/([\\"])/g, '\\$1')}")`);
      return;
    }

    if ($isHorizontalRuleNode(node)) {
      appendText('---');
      return;
    }

    if ($isReviewTextNode(node)) {
      const range = appendText(serializeLexicalTextNode(node, 'wysiwyg'));
      applyReviewMetaToModel(node.getReviewMeta(), range, suggestions, comments, highlights);
      return;
    }

    if ($isTextNode(node)) {
      appendText(serializeLexicalTextNode(node, 'wysiwyg'));
      return;
    }

    if ($isLineBreakNode(node)) {
      appendText('\n');
      return;
    }

    if ($isElementNode(node)) {
      appendElementChildren(node);
    }
  };

  const appendElementChildren = (node: ElementNode): void => {
    const children = node.getChildren();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child !== undefined) {
        appendNode(child);
      }
    }
  };

  const appendTopLevelNode = (node: LexicalNode): void => {
    if ($isHeadingNode(node)) {
      appendText(`${'#'.repeat(Number(node.getTag().slice(1)))} `);
      appendElementChildren(node);
      return;
    }
    if ($isQuoteNode(node)) {
      const start = text.length;
      appendElementChildren(node);
      const quoteBody = text.slice(start);
      text = `${text.slice(0, start)}${quoteBody.split('\n').map(line => `> ${line}`).join('\n')}`;
      return;
    }
    if ($isCodeNode(node)) {
      const language = node.getLanguage() ?? '';
      appendText(`\`\`\`${language}`);
      if (node.getTextContent().length > 0) {
        appendText(`\n${node.getTextContent()}`);
      }
      appendText('\n```');
      return;
    }
    if ($isListNode(node)) {
      appendListNode(node);
      return;
    }
    appendNode(node);
  };

  const appendListNode = (node: ListNode): void => {
    const children = node.getChildren();
    let itemIndex = 0;
    for (const child of children) {
      if (!$isListItemNode(child)) {
        continue;
      }
      if (itemIndex > 0) {
        appendText('\n');
      }
      const prefix = node.getListType() === 'number'
        ? `${node.getStart() + itemIndex}. `
        : node.getListType() === 'check'
          ? `- [${child.getChecked() ? 'x' : ' '}] `
          : '- ';
      appendText(prefix);
      appendElementChildren(child);
      itemIndex += 1;
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
      appendText(DOUBLE_LINE_BREAK);
    }
    appendTopLevelNode(child);
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
}

function collectProjectedAnnotationsFromLexical(): ProjectedAnnotations {
  const suggestions: ProjectedSuggestionMeta[] = [];
  const comments: ProjectedCommentMeta[] = [];
  const pointComments: (ReviewCommentMeta & {offset: number})[] = [];
  const highlights: (ReviewHighlight & {range: ReviewRange})[] = [];
  let offset = 0;

  const visit = (node: LexicalNode): void => {
    if ($isReviewCommentAnchorNode(node)) {
      const comment = node.getComment();
      pointComments.push({...comment, offset});
      return;
    }

    if ($isReviewTextNode(node)) {
      const range = {end: offset + node.getTextContent().length, start: offset};
      const meta = node.getReviewMeta();
      offset = range.end;
      if (range.start !== range.end && meta !== null) {
        if (meta.suggestion !== undefined) {
          suggestions.push({...meta.suggestion, range});
        }
        if (meta.comment !== undefined) {
          comments.push({...meta.comment, range});
        }
        if (meta.highlightId !== undefined) {
          highlights.push({
            end: range.end,
            id: meta.highlightId,
            range,
            start: range.start,
          });
        }
      }
      return;
    }

    if ($isTextNode(node) || $isLineBreakNode(node)) {
      offset += node.getTextContent().length;
      return;
    }

    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child !== undefined) {
          visit(child);
          if ($isElementNode(child) && !child.isInline() && index !== children.length - 1) {
            offset += DOUBLE_LINE_BREAK.length;
          }
        }
      }
    }
  };

  visit($getRoot());
  return {comments, highlights, pointComments, suggestions};
}

function createMarkdownSourceMap(
  markdown: string,
  hardBoundaries: readonly number[] = [],
): MarkdownSourceMap {
  const builder = new MarkdownSourceMapBuilder(markdown, hardBoundaries);
  const lines = markdownLines(markdown);
  let index = 0;
  let inCodeFence = false;
  let codeFence: string | null = null;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }
    const text = markdown.slice(line.start, line.contentEnd);

    if (inCodeFence) {
      const fenceEnd = codeFence === null
        ? null
        : new RegExp(`^[ \\t]*${escapeRegExp(codeFence)}[ \\t]*$`);
      if (fenceEnd?.test(text)) {
        builder.skipTo(line.end);
        inCodeFence = false;
        codeFence = null;
      } else {
        builder.emitInline(line.start, line.contentEnd, {parseMarkdown: false});
        if (line.newlineStart !== null) {
          builder.emitSource(line.newlineStart, '\n');
        }
      }
      index += 1;
      continue;
    }

    const fenceStart = text.match(/^([ \t]*`{3,})([\w-]+)?[ \t]?/);
    const fence = fenceStart?.[1];
    if (fence !== undefined) {
      codeFence = fence.trim();
      inCodeFence = true;
      builder.skipTo(line.end);
      index += 1;
      continue;
    }

    const horizontalRule = /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text);
    if (horizontalRule) {
      builder.skipTo(line.contentEnd);
      if (line.newlineStart !== null) {
        builder.emitSource(line.newlineStart, '\n');
      } else {
        builder.emitSynthetic('\n', line.contentEnd);
      }
      index += 1;
      continue;
    }

    const blockPrefix = markdownBlockPrefixLength(text);
    builder.skipTo(line.start + blockPrefix);
    builder.emitInline(line.start + blockPrefix, line.contentEnd, {parseMarkdown: true});

    if (line.newlineStart !== null) {
      builder.emitSource(line.newlineStart, '\n');
      const nextLine = lines[index + 1];
      if (isListLine(text) && nextLine !== undefined && isListLine(markdown.slice(nextLine.start, nextLine.contentEnd))) {
        builder.emitSynthetic('\n', line.newlineStart + 1);
      }
    }

    index += 1;
  }

  return builder.finish();
}

type MarkdownLine = {
  readonly contentEnd: number;
  readonly end: number;
  readonly newlineStart: number | null;
  readonly start: number;
};

class MarkdownSourceMapBuilder {
  private readonly displayToSourceEnd: number[] = [0];
  private readonly displayToSourceStart: number[] = [0];
  private readonly sourceToDisplay: number[];
  private cursor = 0;
  private displayText = '';

  private readonly hardBoundaries: readonly number[];

  constructor(
    private readonly markdown: string,
    hardBoundaries: readonly number[],
  ) {
    this.sourceToDisplay = new Array(markdown.length + 1).fill(0);
    this.hardBoundaries = Array.from(new Set(hardBoundaries))
      .filter(boundary => boundary > 0 && boundary < markdown.length)
      .sort((left, right) => left - right);
  }

  emitInline(
    start: number,
    end: number,
    options: {readonly parseMarkdown: boolean},
  ): void {
    if (!options.parseMarkdown) {
      for (let index = start; index < end; index += 1) {
        this.emitSource(index);
      }
      return;
    }

    let segmentStart = start;
    for (const boundary of this.hardBoundaries) {
      if (boundary <= segmentStart) {
        continue;
      }
      if (boundary >= end) {
        break;
      }
      this.emitInlineMarkdown(segmentStart, boundary);
      this.skipTo(boundary);
      segmentStart = boundary;
    }
    this.emitInlineMarkdown(segmentStart, end);
  }

  emitSource(index: number, value = this.markdown[index] ?? ''): void {
    this.skipTo(index);
    this.displayToSourceStart[this.displayText.length] = index;
    this.displayText += value;
    this.displayToSourceEnd[this.displayText.length] = index + 1;
    this.sourceToDisplay[index + 1] = this.displayText.length;
    this.cursor = index + 1;
  }

  emitSynthetic(value: string, sourceOffset: number): void {
    for (const character of value) {
      this.displayToSourceStart[this.displayText.length] = sourceOffset;
      this.displayText += character;
      this.displayToSourceEnd[this.displayText.length] = sourceOffset;
    }
  }

  skipTo(index: number): void {
    while (this.cursor < index) {
      this.sourceToDisplay[this.cursor + 1] = this.displayText.length;
      this.cursor += 1;
    }
  }

  finish(): MarkdownSourceMap {
    this.skipTo(this.markdown.length);
    this.sourceToDisplay[0] = 0;

    const displayLength = this.displayText.length;
    const starts = new Array(displayLength + 1).fill(Number.POSITIVE_INFINITY);
    const ends = new Array(displayLength + 1).fill(Number.NEGATIVE_INFINITY);

    for (let sourceOffset = 0; sourceOffset < this.sourceToDisplay.length; sourceOffset += 1) {
      const displayOffset = this.sourceToDisplay[sourceOffset] ?? 0;
      starts[displayOffset] = Math.min(starts[displayOffset], sourceOffset);
      ends[displayOffset] = Math.max(ends[displayOffset], sourceOffset);
    }

    for (let displayOffset = 0; displayOffset <= displayLength; displayOffset += 1) {
      const explicitStart = this.displayToSourceStart[displayOffset];
      const explicitEnd = this.displayToSourceEnd[displayOffset];
      if (explicitStart !== undefined && Number.isFinite(explicitStart)) {
        starts[displayOffset] = Math.min(starts[displayOffset] ?? explicitStart, explicitStart);
      }
      if (explicitEnd !== undefined && Number.isFinite(explicitEnd)) {
        ends[displayOffset] = Math.max(ends[displayOffset] ?? explicitEnd, explicitEnd);
      }
      if (!Number.isFinite(starts[displayOffset])) {
        starts[displayOffset] = displayOffset === 0 ? 0 : starts[displayOffset - 1] ?? 0;
      }
      if (!Number.isFinite(ends[displayOffset])) {
        ends[displayOffset] = displayOffset === 0
          ? starts[displayOffset] ?? 0
          : ends[displayOffset - 1] ?? starts[displayOffset] ?? 0;
      }
    }

    return {
      displayText: this.displayText,
      displayToSourceEnd: ends,
      displayToSourceStart: starts,
      sourceToDisplay: this.sourceToDisplay,
    };
  }

  private emitInlineMarkdown(start: number, end: number): void {
    let index = start;
    while (index < end) {
      const escaped = this.markdown[index] === '\\' && index + 1 < end;
      if (escaped) {
        this.skipTo(index + 1);
        this.emitSource(index + 1);
        index += 2;
        continue;
      }

      const link = this.markdown[index] === '['
        ? markdownLinkMatch(this.markdown, index, end)
        : this.markdown[index] === '!' && this.markdown[index + 1] === '['
          ? markdownImageMatch(this.markdown, index, end)
          : null;
      if (link !== null) {
        this.skipTo(link.labelStart);
        this.emitInlineMarkdown(link.labelStart, link.labelEnd);
        this.skipTo(link.end);
        index = link.end;
        continue;
      }

      const delimiter = markdownDelimiterAt(this.markdown, index, end);
      if (delimiter !== null) {
        this.skipTo(index + delimiter.open.length);
        if (delimiter.parseInner) {
          this.emitInlineMarkdown(index + delimiter.open.length, delimiter.closeStart);
        } else {
          for (let inner = index + delimiter.open.length; inner < delimiter.closeStart; inner += 1) {
            this.emitSource(inner);
          }
        }
        this.skipTo(delimiter.closeStart + delimiter.close.length);
        index = delimiter.closeStart + delimiter.close.length;
        continue;
      }

      this.emitSource(index);
      index += 1;
    }
  }
}

function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  while (start <= markdown.length) {
    const newline = markdown.indexOf('\n', start);
    if (newline === -1) {
      lines.push({
        contentEnd: markdown.length,
        end: markdown.length,
        newlineStart: null,
        start,
      });
      break;
    }
    lines.push({
      contentEnd: newline,
      end: newline + 1,
      newlineStart: newline,
      start,
    });
    start = newline + 1;
  }
  return lines;
}

function markdownBlockPrefixLength(line: string): number {
  const heading = line.match(/^(#{1,6})\s+/);
  if (heading !== null) {
    return heading[0].length;
  }
  const quote = line.match(/^>\s?/);
  if (quote !== null) {
    return quote[0].length;
  }
  const list = line.match(/^(\s*)(?:[-*+]|\d{1,}\.)\s+(?:\[(?:\s|x|X)\]\s+)?/);
  return list === null ? 0 : list[0].length;
}

function isListLine(line: string): boolean {
  return /^(\s*)(?:[-*+]|\d{1,}\.)\s+/.test(line);
}

function markdownDelimiterAt(
  markdown: string,
  index: number,
  end: number,
): {close: string; closeStart: number; open: string; parseInner: boolean} | null {
  const delimiters = ['***', '___', '**', '__', '~~', '==', '`', '*', '_'];
  for (const open of delimiters) {
    if (!markdown.startsWith(open, index)) {
      continue;
    }
    const closeStart = markdown.indexOf(open, index + open.length);
    if (closeStart !== -1 && closeStart < end) {
      return {
        close: open,
        closeStart,
        open,
        parseInner: open !== '`',
      };
    }
  }
  return null;
}

function markdownLinkMatch(
  markdown: string,
  index: number,
  end: number,
): {end: number; labelEnd: number; labelStart: number} | null {
  const labelEnd = markdown.indexOf(']', index + 1);
  if (labelEnd === -1 || labelEnd + 1 >= end || markdown[labelEnd + 1] !== '(') {
    return null;
  }
  const linkEnd = markdown.indexOf(')', labelEnd + 2);
  if (linkEnd === -1 || linkEnd >= end) {
    return null;
  }
  return {
    end: linkEnd + 1,
    labelEnd,
    labelStart: index + 1,
  };
}

function markdownImageMatch(
  markdown: string,
  index: number,
  end: number,
): {end: number; labelEnd: number; labelStart: number} | null {
  const link = markdownLinkMatch(markdown, index + 1, end);
  return link === null ? null : {...link, labelStart: index + 2};
}

function sourceRangeToDisplayRange(sourceMap: MarkdownSourceMap, range: ReviewRange): ReviewRange {
  return {
    end: sourceOffsetToDisplayOffset(sourceMap, range.end),
    start: sourceOffsetToDisplayOffset(sourceMap, range.start),
  };
}

function sourceOffsetToDisplayOffset(sourceMap: MarkdownSourceMap, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, sourceMap.sourceToDisplay.length - 1));
  return sourceMap.sourceToDisplay[safeOffset] ?? sourceMap.displayText.length;
}

function displayRangeToSourceRange(sourceMap: MarkdownSourceMap, range: ReviewRange): ReviewRange {
  const start = displayOffsetToSourceOffset(sourceMap, range.start, 'start');
  const end = displayOffsetToSourceOffset(sourceMap, range.end, 'end');
  return start <= end ? {end, start} : {end: start, start: end};
}

function displayOffsetToSourceOffset(
  sourceMap: MarkdownSourceMap,
  offset: number,
  side: 'end' | 'start',
): number {
  const safeOffset = Math.max(0, Math.min(offset, sourceMap.displayText.length));
  const map = side === 'start' ? sourceMap.displayToSourceStart : sourceMap.displayToSourceEnd;
  return map[safeOffset] ?? sourceMap.sourceToDisplay.length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertMarkdownBoundarySentinels(
  value: string,
  boundaries: readonly number[],
): string {
  const safeBoundaries = Array.from(new Set(boundaries))
    .filter(boundary => boundary > 0 && boundary < value.length)
    .sort((left, right) => left - right);
  let output = '';
  let cursor = 0;
  for (const boundary of safeBoundaries) {
    output += value.slice(cursor, boundary);
    output += MARKDOWN_BOUNDARY_SENTINEL;
    cursor = boundary;
  }
  output += value.slice(cursor);
  return output;
}

function removeMarkdownBoundarySentinels(): void {
  for (const node of $getRoot().getAllTextNodes()) {
    const text = node.getTextContent();
    if (text.includes(MARKDOWN_BOUNDARY_SENTINEL)) {
      node.setTextContent(text.replaceAll(MARKDOWN_BOUNDARY_SENTINEL, ''));
    }
  }
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

  if (command.mode === 'wysiwyg' && command.richBlock !== undefined) {
    applyRichBlockFormat(command.richBlock);
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

function applyRichBlockFormat(format: ReviewRichBlockFormat): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }

  switch (format) {
    case 'h1':
    case 'h2':
    case 'h3':
      $setBlocksType(selection, () => $createHeadingNode(format as HeadingTagType));
      return;
    case 'quote':
      $setBlocksType(selection, () => $createQuoteNode());
      return;
    case 'code':
      $setBlocksType(selection, () => $createCodeNode());
      return;
    case 'ul':
      $getEditorDispatchListCommand(INSERT_UNORDERED_LIST_COMMAND);
      return;
    case 'ol':
      $getEditorDispatchListCommand(INSERT_ORDERED_LIST_COMMAND);
      return;
    case 'check':
      $getEditorDispatchListCommand(INSERT_CHECK_LIST_COMMAND);
      return;
    case 'hr':
      $insertNodes([$createHorizontalRuleNode()]);
      return;
  }
}

function $getEditorDispatchListCommand(command: typeof INSERT_UNORDERED_LIST_COMMAND): void;
function $getEditorDispatchListCommand(command: typeof INSERT_ORDERED_LIST_COMMAND): void;
function $getEditorDispatchListCommand(command: typeof INSERT_CHECK_LIST_COMMAND): void;
function $getEditorDispatchListCommand(
  command:
    | typeof INSERT_CHECK_LIST_COMMAND
    | typeof INSERT_ORDERED_LIST_COMMAND
    | typeof INSERT_UNORDERED_LIST_COMMAND,
): void {
  $getEditor().dispatchCommand(command, undefined);
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

function applyReviewImageDom(element: HTMLElement, src: string, title: string | null): void {
  element.className = 'review-image';
  element.dataset.src = src;
  if (title === null) {
    element.removeAttribute('data-title');
    element.removeAttribute('title');
  } else {
    element.dataset.title = title;
    element.title = title;
  }
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

function $createReviewImageNode(src: string, title: string | null = null): ReviewImageNode {
  return $applyNodeReplacement(new ReviewImageNode(src, title));
}

function $isReviewImageNode(node: LexicalNode | null | undefined): node is ReviewImageNode {
  return node instanceof ReviewImageNode;
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
