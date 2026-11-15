/// <reference lib="esnext.disposable" preserve="true" />

import {CodeNode, $createCodeNode, $isCodeNode} from '@lexical/code-core';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/extension';
import {reviewModelsEqual, copyReviewModel} from '../review-model-equality.js';
import {ModelHistory, type ModelSnapshot, type SourceSelection} from './model-history.js';
import {copyValidImages, imageAt, ImagePattern, serializeImage, type ReviewImage, type ReviewImagePasteResult, type ReviewImagePasteOutcome, type ReviewImagePasteFailure, type ReviewMarkdownInspection} from './image-markdown.js';
export type {ReviewImage, ReviewImagePasteResult, ReviewImagePasteOutcome, ReviewImagePasteFailure, ReviewMarkdownInspection} from './image-markdown.js';
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
  $createNodeSelection, $createRangeSelection, $setSelection, $isNodeSelection,
  $createRangeSelectionFromDom,
  DecoratorNode, COMMAND_PRIORITY_HIGH, UNDO_COMMAND, REDO_COMMAND,
  KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND,
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
  type EditorThemeClasses,
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
} from '../review-model.js';

export type ReviewLexicalAdapter = {
  insertImages(images: readonly ReviewImage[]): boolean;
  inspectMarkdown(markdown: string): ReviewMarkdownInspection;
  setImagePreviews(previews: ReadonlyMap<string, string>): void;
  applyMarkdownFormat(command: ReviewMarkdownFormatCommand): void;
  dispose(): void;
  focus(): void;
  getModel(): ReviewModel;
  getSelectionOffset(): number | null;
  readSelectionRange(): ReviewRange | null;
  /** Selection in Markdown source offsets, suitable for ReviewModel comments. */
  readModelSelectionRange(): ReviewRange | null;
  restoreModelSelectionOffset(offset: number | null): void;
  restoreSelectionOffset(offset: number | null): void;
  setEditable(editable: boolean): void;
  setModel(model: ReviewModel, mode: ReviewContentMode): void;
};

export type ReviewClassNames = Partial<Record<
  'change' | 'addition' | 'deletion' | 'highlight' | 'rangeComment' | 'pointComment' | 'image', string
>>;

export type ReviewLexicalAdapterOptions = {
  onPasteImages?: ((files: readonly File[]) => ReviewImagePasteResult) | undefined;
  onPasteImagesResult?: ((outcome: ReviewImagePasteOutcome) => void) | undefined;
  imagePreviews?: ReadonlyMap<string, string>;
  namespace?: string;
  theme?: EditorThemeClasses;
  classNames?: ReviewClassNames;
  onError?(error: Error): void;
  /** Customize the contents of point-comment buttons. Called when created/updated. */
  renderCommentAnchor?(element: HTMLButtonElement, comment: {id: string; value: string}): void;
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
    alt: string;
    title?: string;
  },
  SerializedLexicalNode
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
    applyReviewTextDom(element, this.__review, config);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    if (super.updateDOM(prevNode, dom, config)) {
      return true;
    }
    applyReviewTextDom(dom, this.__review, config);
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

  override createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.innerHTML = commentIconSvg();
    applyPointCommentDom(element, this.__commentId, this.__value, config);
    return element;
  }

  override updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    if (prevNode.__commentId !== this.__commentId || prevNode.__value !== this.__value) {
      applyPointCommentDom(dom, this.__commentId, this.__value, config);
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

class ReviewImageNode extends DecoratorNode<null> {
  __image: ReviewImage;
  static override getType(): string { return 'review-image'; }
  static override clone(node: ReviewImageNode): ReviewImageNode {
    return new ReviewImageNode(node.__image, node.__key);
  }
  static override importJSON(node: SerializedReviewImageNode): ReviewImageNode {
    return $createReviewImageNode(node).updateFromJSON(node);
  }
  constructor(image: ReviewImage, key?: NodeKey) { super(key); this.__image = {...image}; }
  getImage(): ReviewImage { return {...this.getLatest().__image}; }
  override getTextContent(): string { return '\uFFFC'; }
  override createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    element.className = reviewTheme(config).classNames?.image ?? defaultClassNames.image;
    element.contentEditable = 'false';
    element.dataset.critrevImage = '';
    element.dataset.imageKey = this.getKey();
    element.dataset.src = this.__image.src;
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', this.__image.alt || 'Image');
    element.textContent = this.__image.alt ? `Image · ${this.__image.alt} · Preview unavailable` : 'Image · Preview unavailable';
    if (this.__image.title !== undefined) { element.title = this.__image.title; element.dataset.title = this.__image.title; }
    return element;
  }
  override updateDOM(): boolean { return false; }
  override decorate(): null { return null; }
  override exportJSON(): SerializedReviewImageNode {
    return {...super.exportJSON(), ...this.__image, type: ReviewImageNode.getType(), version: 1};
  }
  override isInline(): true { return true; }
}

const IMAGE: TextMatchTransformer = {
  dependencies: [ReviewImageNode],
  export: node => $isReviewImageNode(node) ? serializeImage(node.getImage()) : null,
  importRegExp: new ImagePattern(),
  regExp: new ImagePattern(true),
  replace: (textNode, match) => {
    const parsed = imageAt(match[0]);
    if (parsed) textNode.replace($createReviewImageNode(parsed.image));
  },
  trigger: ')', type: 'text-match',
};

// Lexical's link regexp also matches an escaped opening bracket. Keep literal
// links literal, including when an earlier escaped token precedes a real link.
class UnescapedLinkPattern extends RegExp {
  constructor(private readonly pattern: RegExp) { super(pattern.source, pattern.flags); }
  override exec(text: string): RegExpExecArray | null {
    let offset = 0;
    while (offset < text.length) {
      const match = this.pattern.exec(text.slice(offset));
      if (!match) return null;
      match.index += offset;
      let slashes = 0;
      for (let i = match.index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0) { match.input = text; return match; }
      offset = match.index + 1;
    }
    return null;
  }
}

const SAFE_LINK: TextMatchTransformer = {
  ...LINK,
  importRegExp: new UnescapedLinkPattern(LINK.importRegExp!),
  regExp: new UnescapedLinkPattern(LINK.regExp),
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
  SAFE_LINK,
].filter((transformer, index, transformers) => transformers.indexOf(transformer) === index);

export function createReviewLexicalAdapter(
  rootElement: HTMLElement,
  options: ReviewLexicalAdapterOptions,
): ReviewLexicalAdapter {
  let currentModel = emptyReviewModel();
  let currentMode: ReviewContentMode = 'wysiwyg';
  let applyingModel = false;
  let disposed = false;
  let generation = 0;
  let transactionErrors: Error[] | null = null;
  let previews = new Map(options.imagePreviews);
  const previewElements = new Set<HTMLElement>();
  const history = new ModelHistory();
  const forwardErrors = (errors: unknown[]): void => {
    for (const value of errors) {
      const error = value instanceof Error ? value : new Error(String(value));
      if (options.onError) options.onError(error); else throw error;
    }
  };
  const editor = createEditor({
    namespace: options.namespace ?? 'critrev',
    nodes: reviewNodes(),
    onError(error) {
      if (transactionErrors) transactionErrors.push(error);
      else forwardErrors([error]);
    },
    theme: {...options.theme, critrev: {classNames: options.classNames, renderCommentAnchor: options.renderCommentAnchor}},
  });
  editor.setRootElement(rootElement);
  rootElement.dataset.editorEngine = 'lexical';
  rootElement.contentEditable = 'true';
  let unregisterShortcuts = registerMarkdownShortcuts(editor, REVIEW_MARKDOWN_TRANSFORMERS);

  const domSelectionInside = (): boolean => {
    const sel = rootElement.ownerDocument.getSelection();
    return !!sel?.anchorNode && !!sel.focusNode && rootElement.contains(sel.anchorNode) && rootElement.contains(sel.focusNode);
  };
  const selectionFor = (state = editor.getEditorState(), model = currentModel, mode = currentMode): SourceSelection | null => state.read(() => {
    const selection = $getSelection();
    const range = modelDisplaySelectionRange();
    if (!range) return null;
    let anchor = range.start, focus = range.end;
    if ($isRangeSelection(selection) && selection.isBackward()) [anchor, focus] = [focus, anchor];
    if (mode === 'wysiwyg') {
      const map = createMarkdownSourceMap(model.text, modelBoundaries(model));
      const collapsed = anchor === focus;
      const convert = (x: number, start: boolean) => displayOffsetToSourceOffset(map, x, collapsed ? 'start' : start ? 'end' : 'start');
      const backward = anchor > focus;
      anchor = convert(anchor, !backward); focus = convert(focus, backward);
      // Atoms include their full token, rather than excluding its delimiters.
      if ($isNodeSelection(selection)) {
        anchor = displayOffsetToSourceOffset(map, range.start, 'start');
        focus = displayOffsetToSourceOffset(map, range.end, 'end');
      }
    }
    const sourceAtom = mode === 'source' && anchor !== focus ? imageAt(model.text, Math.min(anchor, focus)) : null;
    return {anchor, focus, ...($isNodeSelection(selection) || sourceAtom?.end === Math.max(anchor, focus) ? {atom: true} : {})};
  });
  const restore = (selection: SourceSelection | null): void => {
    if (!selection) return;
    const map = currentMode === 'source' ? null : createMarkdownSourceMap(currentModel.text, modelBoundaries(currentModel));
    const anchor = map ? sourceOffsetToDisplayOffset(map, selection.anchor) : selection.anchor;
    const focus = map ? sourceOffsetToDisplayOffset(map, selection.focus) : selection.focus;
    if (selection.atom && currentMode === 'wysiwyg') {
      const atom = modelDisplayPoints().find(x => $isReviewImageNode(x.node) && x.start === Math.min(anchor, focus));
      if (atom) { const selected = $createNodeSelection(); selected.add(atom.node.getKey()); $setSelection(selected); return; }
    }
    selectModelDisplayRange(anchor, focus);
  };
  const clearPreview = (element: HTMLElement): void => {
    const image = element.querySelector('img');
    if (image) { image.onerror = null; image.removeAttribute('src'); }
    element.replaceChildren();
    delete element.dataset.previewUrl;
  };
  const refreshPreviews = (): void => {
    if (disposed) return;
    for (const element of previewElements) {
      if (!rootElement.contains(element)) { clearPreview(element); previewElements.delete(element); }
    }
    const selected = editor.getEditorState().read(() => {
      const selection = $getSelection(); return $isNodeSelection(selection) ? new Set(selection.getNodes().map(n => n.getKey())) : new Set<string>();
    });
    for (const element of rootElement.querySelectorAll<HTMLElement>('[data-critrev-image]')) {
      previewElements.add(element);
      if (selected.has(element.dataset.imageKey!)) element.dataset.critrevImageSelected = 'true';
      else delete element.dataset.critrevImageSelected;
      const binding = previews.get(element.dataset.src!);
      if (binding !== undefined && element.dataset.previewUrl === binding) continue;
      const label = element.getAttribute('aria-label') || 'Image';
      clearPreview(element);
      const placeholder = () => { element.textContent = `${label === 'Image' ? label : `Image · ${label}`} · Preview unavailable`; };
      if (binding === undefined) { placeholder(); continue; }
      element.dataset.previewUrl = binding;
      const image = element.ownerDocument.createElement('img');
      image.alt = label === 'Image' ? '' : label;
      image.draggable = false;
      image.onerror = () => {
        if (!disposed && element.dataset.previewUrl === binding && image.parentElement === element) {
          image.onerror = null; image.removeAttribute('src'); placeholder();
        }
      };
      element.append(image); image.src = binding;
    }
  };
  const write = (model: ReviewModel, selection: SourceSelection | null, keepFocus = true): void => {
    applyingModel = true;
    try {
      editor.update(() => { writeReviewModelToLexical(model, currentMode); restore(selection); },
        {discrete: true, tag: keepFocus ? 'critrev-set-model' : ['critrev-set-model', 'skip-dom-selection']});
    } finally { applyingModel = false; }
    refreshPreviews();
  };
  const inspect = (markdown: string): ReviewMarkdownInspection => {
    if (disposed || !rootElement.isConnected) throw new Error('Markdown inspection requires a mounted browser editor.');
    const projectedMarkdown = projectMarkdown(markdown);
    return {exact: markdown === projectedMarkdown, projectedMarkdown};
  };
  const emit = (selection: SourceSelection | null): void => options.onChange(cloneReviewModel(currentModel), selection?.anchor === selection?.focus ? selection?.anchor ?? null : null);
  const replay = (direction: 'undo' | 'redo'): boolean => {
    if (disposed || !editor.isEditable()) return false;
    let committed: ModelSnapshot | null = null;
    const changed = history.replay(direction, target => {
      if (currentMode === 'wysiwyg' && !target.model.suggestions.length && !target.model.comments.length && !target.model.highlights.length && !inspect(target.model.text).exact) return false;
      currentModel = cloneReviewModel(target.model);
      write(currentModel, target.selection);
      committed = target;
      return true;
    });
    if (changed && committed) { generation += 1; emit((committed as ModelSnapshot).selection); }
    return changed;
  };
  const eligible = (): boolean => !disposed && editor.isEditable() && domSelectionInside() && selectionFor() !== null;
  const synchronizeSelection = (): void => {
    if (disposed || !editor.isEditable() || !domSelectionInside()) return;
    // Native selectionchange may not have committed yet, especially when the
    // host selects text and inserts in the same event. Snapshot the live range.
    // A new native range also supersedes an earlier image node selection.
    editor.update(() => {
      const selection = $createRangeSelectionFromDom(rootElement.ownerDocument.getSelection(), editor);
      if (selection) $setSelection(selection);
    }, {discrete: true, tag: 'critrev-set-model'});
  };
  const stamp = () => {
    const selection = rootElement.ownerDocument.getSelection();
    return {generation, anchor: selection?.anchorNode, anchorOffset: selection?.anchorOffset,
      focus: selection?.focusNode, focusOffset: selection?.focusOffset};
  };
  const sameStamp = (before: ReturnType<typeof stamp>) => {
    const after = stamp();
    return eligible() && before.generation === after.generation && before.anchor === after.anchor && before.anchorOffset === after.anchorOffset && before.focus === after.focus && before.focusOffset === after.focusOffset;
  };
  const commitImages = (images: ReviewImage[], errors: unknown[]): boolean => {
    synchronizeSelection();
    const selection = selectionFor();
    if (!eligible() || !selection) return false;
    const start = Math.min(selection.anchor, selection.focus), end = Math.max(selection.anchor, selection.focus);
    const inserted = images.map(serializeImage).join('');
    let candidate = {...currentModel, text: currentModel.text.slice(0, start) + inserted + currentModel.text.slice(end)};
    const before: ModelSnapshot = {model: cloneReviewModel(currentModel), selection};
    const saved = editor.getEditorState();
    let afterSelection: SourceSelection = {anchor: start + inserted.length, focus: start + inserted.length};
    transactionErrors = [];
    try {
      // Prepare before replacing the live document. Rich mode edits an isolated
      // state; source mode edits syntax. Neither exposes events or history here.
      const preparation = createEditor({namespace: 'critrev-prepare', nodes: reviewNodes(), onError(error) { throw error; }});
      try {
        if (currentMode === 'wysiwyg') {
          preparation.setEditorState(saved.clone());
          preparation.update(() => insertRichImageNodes(images), {discrete: true});
          candidate = editorStateToReviewSnapshot(preparation.getEditorState(), currentMode).model;
          const following = selectionFor(preparation.getEditorState(), candidate);
          if (!following || following.anchor !== following.focus || projectMarkdown(candidate.text) !== candidate.text) {
            throw new Error('Image insertion could not preserve a replayable rich document.');
          }
          afterSelection = following;
        } else {
          preparation.update(() => writeReviewModelToLexical(candidate, currentMode), {discrete: true});
        }
      } finally { preparation.setRootElement(null); }
      currentModel = candidate;
      write(candidate, afterSelection);
      if (transactionErrors.length) throw transactionErrors[0];
      currentModel = editorStateToReviewSnapshot(editor.getEditorState(), currentMode).model;
    } catch (error) {
      currentModel = before.model;
      applyingModel = true;
      try { editor.setEditorState(saved, {tag: 'critrev-set-model'}); } finally { applyingModel = false; }
      refreshPreviews(); errors.push(error); return false;
    } finally { transactionErrors = null; }
    history.record(before, {model: currentModel, selection: afterSelection});
    generation += 1;
    try { emit(afterSelection); } catch (error) { errors.push(error); }
    return true;
  };
  const paste = (event: ClipboardEvent): void => {
    if (!options.onPasteImages || disposed || !editor.isEditable() || !domSelectionInside()) return;
    const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    synchronizeSelection();
    if (!eligible()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const before = stamp();
    const errors: unknown[] = [];
    let reason: ReviewImagePasteFailure | null = null;
    let images: ReviewImage[] | null = null;
    try {
      const result: unknown = options.onPasteImages(files);
      if (!sameStamp(before)) reason = 'selection-unavailable';
      else if (result && typeof result === 'object' && !('then' in result) && Object.keys(result).length === 1 && 'reject' in result && result.reject === true) reason = 'rejected';
      else if (!result || typeof result !== 'object' || 'then' in result || Object.keys(result).length !== 1 || !('images' in result) || !Array.isArray(result.images) || !result.images.length) reason = 'invalid-result';
      else if (result.images.length !== files.length) reason = 'count-mismatch';
      else { images = copyValidImages(result.images); if (!images) reason = 'invalid-image'; }
    } catch (error) { reason = 'callback-error'; errors.push(error); }
    const inserted = !reason && images !== null && commitImages(images, errors);
    const outcome: ReviewImagePasteOutcome = inserted && images ? {files, inserted: true, images: images.map(x => ({...x}))} : {files, inserted: false, reason: reason ?? 'insertion-failed'};
    try { options.onPasteImagesResult?.(outcome); } catch (error) { errors.push(error); }
    forwardErrors(errors);
  };
  const pointer = (event: MouseEvent): void => {
    const element = (event.target as Element).closest<HTMLElement>('[data-critrev-image]');
    if (!element || !rootElement.contains(element) || !editor.isEditable()) return;
    // Own atom activation before Lexical's native pointer/click handlers turn
    // this gesture into a text selection or clear the selected node.
    event.preventDefault(); event.stopImmediatePropagation(); rootElement.focus(); history.boundary();
    editor.update(() => { const selection = $createNodeSelection(); selection.add(element.dataset.imageKey!); $setSelection(selection); }, {discrete: true});
    refreshPreviews();
  };
  rootElement.addEventListener('paste', paste, true);
  rootElement.addEventListener('pointerdown', pointer, true);
  rootElement.addEventListener('click', pointer, true);
  const atomArrow = (event: KeyboardEvent | null, direction: -1 | 1): boolean => {
    if (!editor.isEditable() || currentMode !== 'wysiwyg') return false;
    const selection = $getSelection();
    const points = modelDisplayPoints();
    if ($isNodeSelection(selection)) {
      const node = selection.getNodes()[0];
      const point = points.find(x => x.node.is(node));
      if (!point) return false;
      event?.preventDefault(); selectModelDisplayOffset(direction === -1 ? point.start : point.end); return true;
    }
    const range = modelDisplaySelectionRange();
    if (!$isRangeSelection(selection) || !selection.isCollapsed() || !range) return false;
    const atom = points.find(x => $isReviewImageNode(x.node) && (direction === 1 ? x.start === range.end : x.end === range.start));
    if (!atom) return false;
    event?.preventDefault(); const selected = $createNodeSelection(); selected.add(atom.node.getKey()); $setSelection(selected); history.boundary(); return true;
  };
  const deleteAtom = (event: KeyboardEvent | null): boolean => {
    const selected = $getSelection();
    if (!editor.isEditable() || !$isNodeSelection(selected) || !selected.getNodes().some($isReviewImageNode)) return false;
    event?.preventDefault(); history.boundary();
    const nodes = selected.getNodes();
    const first = nodes[0]; if (first) first.selectPrevious();
    nodes.forEach(node => node.remove());
    return true;
  };
  const cleanup = mergeRegister(
    registerRichText(editor), registerList(editor), registerCheckList(editor),
    editor.registerCommand(UNDO_COMMAND, () => { replay('undo'); return true; }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(REDO_COMMAND, () => { replay('redo'); return true; }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_ARROW_LEFT_COMMAND, event => atomArrow(event, -1), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, event => atomArrow(event, 1), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_BACKSPACE_COMMAND, deleteAtom, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_DELETE_COMMAND, deleteAtom, COMMAND_PRIORITY_HIGH),
    editor.registerUpdateListener(({dirtyElements, dirtyLeaves, editorState, prevEditorState, tags}) => {
      if (applyingModel || tags.has('critrev-set-model')) { refreshPreviews(); return; }
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) { refreshPreviews(); return; }
      const snapshot = editorStateToReviewSnapshot(editorState, currentMode);
      if (reviewModelsEqual(snapshot.model, currentModel)) { refreshPreviews(); return; }
      const before = {model: currentModel, selection: selectionFor(prevEditorState)};
      const after = {model: snapshot.model, selection: selectionFor(editorState, snapshot.model)};
      history.record(before, after, !before.selection?.atom && !after.selection?.atom);
      currentModel = cloneReviewModel(snapshot.model); generation += 1;
      refreshPreviews(); emit(after.selection);
    }),
  );
  return {
    insertImages(value) {
      if (disposed || !editor.isEditable() || !domSelectionInside()) return false;
      const errors: unknown[] = [];
      let images: ReviewImage[] | null;
      try { images = copyValidImages(value); } catch { return false; }
      if (!images) return false;
      const inserted = commitImages(images, errors); forwardErrors(errors); return inserted;
    },
    inspectMarkdown: inspect,
    setImagePreviews(value) { if (disposed) return; previews = new Map(value); refreshPreviews(); },
    applyMarkdownFormat(command) {
      if (disposed || !editor.isEditable()) return;
      history.boundary(); editor.update(() => applyMarkdownFormatToSelection(command), {discrete: true}); history.boundary();
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation += 1;
      rootElement.removeEventListener('paste', paste, true); rootElement.removeEventListener('pointerdown', pointer, true);
      rootElement.removeEventListener('click', pointer, true);
      for (const element of previewElements) clearPreview(element);
      previewElements.clear(); previews.clear(); unregisterShortcuts(); cleanup(); editor.setRootElement(null); rootElement.replaceChildren(); history.clear();
    },
    focus() { if (!disposed) editor.focus(); },
    getModel() { return cloneReviewModel(currentModel); },
    getSelectionOffset() { const range = readDomSelectionRange(rootElement); return range?.start === range?.end ? range?.start ?? null : null; },
    readSelectionRange() { return readDomSelectionRange(rootElement); },
    readModelSelectionRange() {
      if (disposed || !domSelectionInside()) return null;
      const range = selectionFor(); return range ? {start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus)} : null;
    },
    restoreModelSelectionOffset(offset) {
      if (disposed || offset === null) return;
      rootElement.focus(); editor.update(() => restore({anchor: offset, focus: offset}), {discrete: true});
    },
    restoreSelectionOffset(offset) {
      if (disposed || offset === null) return;
      rootElement.focus(); editor.update(() => selectLexicalOffset(offset), {discrete: true});
    },
    setEditable(editable) {
      if (disposed) return;
      if (editor.isEditable() !== editable) generation += 1;
      editor.setEditable(editable); rootElement.contentEditable = String(editable); rootElement.setAttribute('aria-readonly', String(!editable));
    },
    setModel(model, mode) {
      if (disposed) return;
      const equal = reviewModelsEqual(model, currentModel);
      if (equal && currentMode === mode) return;
      const selection = equal ? selectionFor() : null;
      const keepFocus = domSelectionInside();
      if (!equal) history.clear(); else history.boundary();
      if (currentMode !== mode) { unregisterShortcuts(); unregisterShortcuts = mode === 'wysiwyg' ? registerMarkdownShortcuts(editor, REVIEW_MARKDOWN_TRANSFORMERS) : () => {}; }
      currentMode = mode; currentModel = cloneReviewModel(model); generation += 1;
      write(currentModel, selection, keepFocus);
    },
  };
}

/** @internal Shared by the mounted inspection method and importer/exporter regression tests. */
export function projectMarkdown(markdown: string): string {
  const isolated = createEditor({namespace: 'critrev-inspect', nodes: reviewNodes(), onError(error) { throw error; }});
  try {
    isolated.update(() => writeWysiwygReviewModelToLexical({...emptyReviewModel(), text: markdown}), {discrete: true});
    return editorStateToReviewSnapshot(isolated.getEditorState(), 'wysiwyg').model.text;
  } finally { isolated.setRootElement(null); }
}

function reviewNodes() {
  return [CodeNode, HeadingNode, HorizontalRuleNode, LinkNode, ListItemNode, ListNode, QuoteNode,
    ReviewCommentAnchorNode, ReviewImageNode, ReviewTextNode];
}

/** Insert actual atoms before exporting; Markdown string splices lose rich context. */
function insertRichImageNodes(images: ReviewImage[]): void {
  const atoms = images.map(image => $createReviewImageNode(image));
  $insertNodes(atoms);
  const first = atoms[0]!;
  const parent = first.getParentOrThrow();
  if ($isCodeNode(parent)) {
    // A code block serializes all descendants as literal code. Keep the code on
    // either side in its own block and place the images in a normal paragraph.
    const following = parent.getChildren().slice(first.getIndexWithinParent() + atoms.length);
    const paragraph = $createParagraphNode().append(...atoms);
    parent.insertAfter(paragraph);
    if (following.length) paragraph.insertAfter($createCodeNode(parent.getLanguage()).append(...following));
    if (parent.getChildrenSize() === 0) parent.remove();
  }
  atoms[atoms.length - 1]!.selectNext(0, 0);
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
      selectionOffset = text.length + offsetInsideSelectionNode(node, selectionPoint.offset, 'wysiwyg');
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
      appendText(serializeImage(node.getImage()));
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
      const fence = '`'.repeat(Math.max(3, ...((node.getTextContent().match(/`+/g) ?? []).map(x => x.length + 1))));
      appendText(`${fence}${language}`);
      if (node.getTextContent().length > 0) {
        appendText(`\n${node.getTextContent()}`);
      }
      appendText(`\n${fence}`);
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

/** @internal Source offsets shared by editing and annotation projection. */
export function createMarkdownSourceMap(
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
  private readonly atomEdges = new Map<number, number>();
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

    for (const [display, source] of this.atomEdges) { starts[display] = source; ends[display] = source; }
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
        this.atomEdges.set(this.displayText.length, index);
        this.skipTo(index + 1);
        this.emitSource(index + 1);
        this.atomEdges.set(this.displayText.length, index + 2);
        index += 2;
        continue;
      }

      const image = imageAt(this.markdown, index);
      if (image && image.end <= end) {
        this.atomEdges.set(this.displayText.length, index);
        this.skipTo(image.end - 1); this.emitSource(image.end - 1, '\uFFFC');
        this.atomEdges.set(this.displayText.length, image.end);
        index = image.end; continue;
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
  if (markdown[index] === '`') {
    const open = markdown.slice(index, end).match(/^`+/)?.[0] ?? '`';
    const runs = markdown.slice(index + open.length, end).matchAll(/`+/g);
    for (const run of runs) {
      if (run[0].length !== open.length) continue;
      const closeStart = index + open.length + run.index;
      const body = markdown.slice(index + open.length, closeStart);
      const padded = body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body);
      return {open: open + (padded ? ' ' : ''), close: (padded ? ' ' : '') + open,
        closeStart: closeStart - (padded ? 1 : 0), parseInner: false};
    }
    return null;
  }
  const delimiters = ['***', '___', '**', '__', '~~', '*', '_'];
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

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>~]/g, '\\$&')
    .replace(/!\[/g, '\\![')
    .replace(/(^|\n)(#+|[-+](?=[-+]*[ \t]*$)|[-+])(?=\s|$|[-+])/g, '$1\\$2')
    .replace(/(^|\n)(\d+)([.)])(?=\s)/g, '$1$2\\$3');
}
function textSerialization(node: TextNode): {prefix: string; body: (text: string) => string; suffix: string; offset?: (offset: number) => number} {
  if (node.hasFormat('code')) {
    const text = node.getTextContent();
    const length = Math.max(0, ...(text.match(/`+/g) ?? []).map(x => x.length)) + 1;
    const delimiter = '`'.repeat(length);
    const padding = /^`|`$/.test(text) || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
    return {prefix: delimiter + padding, body: x => x, suffix: padding + delimiter};
  }
  let prefix = '', suffix = '';
  for (const [format, delimiter] of [['bold', '**'], ['italic', '*'], ['strikethrough', '~~']] as const) {
    if (node.hasFormat(format)) { prefix = delimiter + prefix; suffix += delimiter; }
  }
  const text = node.getTextContent();
  if (prefix && /^\s|\s$/.test(text)) {
    const leading = text.match(/^\s*/u)![0];
    const end = text.trimEnd().length;
    if (leading.length >= end) return {prefix: '', body: escapeMarkdownText, suffix: ''};
    const opening = escapeMarkdownText(leading) + prefix;
    const body = (value: string) => escapeMarkdownText(value.slice(leading.length, end));
    return {
      prefix: opening, body, suffix: suffix + escapeMarkdownText(text.slice(end)),
      offset: value => value <= leading.length ? escapeMarkdownText(text.slice(0, value)).length
        : opening.length + body(text.slice(0, value)).length +
          (value > end ? suffix.length + escapeMarkdownText(text.slice(end, value)).length : 0),
    };
  }
  return {prefix, body: escapeMarkdownText, suffix};
}
function serializeLexicalTextNode(node: TextNode, mode: ReviewContentMode): string {
  const text = node.getTextContent();
  if (mode === 'source' || !text) return text;
  const {prefix, body, suffix} = textSerialization(node);
  return prefix + body(text) + suffix;
}

function offsetInsideSelectionNode(node: LexicalNode, offset: number, mode: ReviewContentMode = 'source'): number {
  if ($isTextNode(node)) {
    const bounded = Math.min(offset, node.getTextContent().length);
    if (mode === 'source') return bounded;
    const {prefix, body, offset: sourceOffset} = textSerialization(node);
    return sourceOffset ? sourceOffset(bounded) : prefix.length + body(node.getTextContent().slice(0, bounded)).length;
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

    if (node.matches('[data-critrev-comment-anchor]')) {
      return;
    }

    if (node.matches('[data-critrev-image]')) { textOffset += 1; return; }

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

    if (node.matches('[data-critrev-comment-anchor]')) {
      return null;
    }

    if (node.matches('[data-critrev-image]')) {
      if (remaining <= 1 && node.parentNode) return childPosition(node.parentNode, node, remaining > 0 ? 1 : 0);
      remaining -= 1; return null;
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
  if (!(node instanceof HTMLElement) || node.matches('[data-critrev-comment-anchor]')) {
    return 0;
  }
  if (node.tagName === 'BR' || node.matches('[data-critrev-image]')) {
    return 1;
  }
  return Array.from(node.childNodes).reduce((total, child) => total + textLengthOfDomNode(child), 0);
}

function rootContainsBoundary(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node);
}

const defaultClassNames = {
  change: 'review-change', addition: 'review-addition', deletion: 'review-deletion',
  highlight: 'review-highlight', rangeComment: 'review-range-comment',
  pointComment: 'comment-anchor', image: 'review-image',
};

function reviewTheme(config: EditorConfig): Pick<ReviewLexicalAdapterOptions, 'classNames' | 'renderCommentAnchor'> {
  return config.theme.critrev ?? {};
}

function classTokens(value: string): string[] { return value.split(/\s+/).filter(Boolean); }

function applyReviewTextDom(element: HTMLElement, meta: ReviewTextMeta | null, config: EditorConfig): void {
  const names = {...defaultClassNames, ...reviewTheme(config).classNames};
  for (const key of ['change', 'addition', 'deletion', 'highlight', 'rangeComment'] as const) {
    element.classList.remove(...classTokens(names[key]));
  }
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
    element.classList.add(...classTokens(names.change));
    element.classList.add(...classTokens(meta.suggestion.part === 'new' ? names.addition : names.deletion));
    element.dataset.changeIndex = String(meta.suggestion.changeIndex);
    element.dataset.changeKind = meta.suggestion.type;
    element.dataset.suggestionId = meta.suggestion.id;
    element.dataset.suggestionPart = meta.suggestion.part;
    element.tabIndex = 0;
  }

  if (meta?.comment !== undefined) {
    element.classList.add(...classTokens(names.rangeComment));
    element.dataset.commentId = meta.comment.id;
    element.dataset.commentValue = meta.comment.value;
    element.dataset.testid = 'range-comment';
    element.tabIndex = 0;
  }

  if (meta?.highlightId !== undefined) {
    element.classList.add(...classTokens(names.highlight));
    element.dataset.highlightId = meta.highlightId;
  }
}

function applyPointCommentDom(element: HTMLElement, commentId: string, value: string, config: EditorConfig): void {
  const options = reviewTheme(config);
  element.className = options.classNames?.pointComment ?? defaultClassNames.pointComment;
  element.dataset.critrevCommentAnchor = '';
  options.renderCommentAnchor?.(element as HTMLButtonElement, {id: commentId, value});
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

function $createReviewImageNode(image: ReviewImage): ReviewImageNode {
  return $applyNodeReplacement(new ReviewImageNode(image));
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

function cloneReviewModel(model: ReviewModel): ReviewModel { return copyReviewModel(model); }

function emptyReviewModel(): ReviewModel {
  return {comments: [], highlights: [], suggestions: [], text: ''};
}

function commentIconSvg(): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3V5Z"></path></svg>`;
}

function modelDisplayPoints(): {node: LexicalNode; start: number; end: number}[] {
  const points: {node: LexicalNode; start: number; end: number}[] = [];
  let offset = 0;
  const visit = (node: LexicalNode): void => {
    const point = {node, start: offset, end: offset};
    points.push(point);
    if ($isReviewCommentAnchorNode(node)) return;
    if ($isReviewImageNode(node)) offset += 1;
    else if ($isTextNode(node) || $isLineBreakNode(node)) offset += node.getTextContent().length;
    else if ($isElementNode(node)) {
      const children = node.getChildren();
      children.forEach((child, index) => {
        visit(child);
        if ($isElementNode(child) && !child.isInline() && index < children.length - 1) offset += 2;
      });
    }
    point.end = offset;
  };
  visit($getRoot());
  return points;
}

function modelDisplaySelectionRange(): ReviewRange | null {
  const selection = $getSelection();
  const points = modelDisplayPoints();
  if ($isNodeSelection(selection)) {
    const selected = points.filter(x => selection.has(x.node.getKey()));
    return selected.length ? {start: Math.min(...selected.map(x => x.start)), end: Math.max(...selected.map(x => x.end))} : null;
  }
  if (!$isRangeSelection(selection)) return null;
  const offset = (key: string, index: number): number => {
    const point = points.find(item => item.node.getKey() === key);
    if (!point) return 0;
    if ($isElementNode(point.node)) {
      const child = point.node.getChildAtIndex(index);
      return child ? points.find(item => item.node.is(child))?.start ?? point.end : point.end;
    }
    return Math.min(point.start + index, point.end);
  };
  const start = offset(selection.anchor.key, selection.anchor.offset);
  const end = offset(selection.focus.key, selection.focus.offset);
  return {start: Math.min(start, end), end: Math.max(start, end)};
}

function selectModelDisplayRange(anchor: number, focus: number): void {
  const points = modelDisplayPoints();
  const pointAt = (offset: number): {key: string; offset: number; type: 'text' | 'element'} => {
    for (const point of points) {
      if ($isTextNode(point.node) && point.start <= offset && point.end >= offset) return {key: point.node.getKey(), offset: offset - point.start, type: 'text'};
      if ($isReviewImageNode(point.node) && point.start <= offset && point.end >= offset) {
        const parent = point.node.getParentOrThrow();
        return {key: parent.getKey(), offset: point.node.getIndexWithinParent() + (offset > point.start ? 1 : 0), type: 'element'};
      }
    }
    const root = $getRoot(); const last = root.getLastChild();
    return $isElementNode(last) ? {key: last.getKey(), offset: last.getChildrenSize(), type: 'element'} : {key: root.getKey(), offset: root.getChildrenSize(), type: 'element'};
  };
  const start = pointAt(anchor), end = pointAt(focus);
  const selection = $createRangeSelection();
  selection.anchor.set(start.key, start.offset, start.type); selection.focus.set(end.key, end.offset, end.type); $setSelection(selection);
}
function selectModelDisplayOffset(offset: number): void { selectModelDisplayRange(offset, offset); }
