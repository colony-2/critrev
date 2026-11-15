import {StrictMode, useRef, useState, version as reactVersion} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync, version as reactDOMVersion} from 'react-dom';
import {ReviewEditor, type ReviewEditorHandle, type ReviewImage, type ReviewImagePasteOutcome} from 'critrev/react';
import {createReviewLexicalAdapter, type ReviewLexicalAdapter, type ReviewContentMode} from 'critrev/lexical';
import type {ReviewModel} from 'critrev';
import {$getRoot, $createParagraphNode, $createTextNode, $createLineBreakNode, type LexicalEditor} from 'lexical';
import './image-fixture.css';

const model = (text: string): ReviewModel => ({text, comments: [], highlights: [], suggestions: []});
const clone = <T,>(value: T): T => structuredClone(value);
const params = new URLSearchParams(location.search);
const surface = params.get('surface') ?? 'react';
let adapter: ReviewLexicalAdapter | null = null;
let handle: ReviewEditorHandle | null = null;
let peerAdapter: ReviewLexicalAdapter | null = null;
let peerRoot: HTMLElement | null = null;
let current = model('Before target after');
let mode: ReviewContentMode = params.get('mode') === 'source' ? 'source' : 'wysiwyg';
let previews = new Map<string, string>();
let flags: Record<string, unknown> = {};
let revision = 0;
let setter: ((next: ReviewModel) => void) | undefined;
let rerender: (() => void) | undefined;
let teardown: (() => void) | undefined;
const logs: unknown[] = [];
let staged: readonly File[] = [];
const root = () => document.querySelector<HTMLElement>('[data-fixture-editor]')!;
const commit = (next: ReviewModel) => {
  current = clone(next);
  if (surface === 'react') flushSync(() => setter?.(clone(next)));
  else adapter?.setModel(current, mode);
};
const render = () => { if (surface === 'react') flushSync(() => rerender?.()); };
const setMode = (value: ReviewContentMode) => { mode = value; if (surface === 'react') render(); else adapter?.setModel(current, mode); };
const setFlags = (value: Record<string, unknown>) => {
  flags = value;
  if (surface === 'react') render(); else adapter?.setEditable(!flags.readOnly && !flags.noChange && !flags.view);
};
const images: ReviewImage[] = [{src: 'pasted-a.png', alt: 'Flow diagram', title: 'Draft flow'}, {src: 'pasted-b.png', alt: '', title: ''}];
const pasteHandler = (files: readonly File[]): never | {images: readonly ReviewImage[]} | {reject: true} => {
  staged = files; logs.push({paste: files.map(x => x.name), revision});
  switch (flags.paste) {
    case 'reject': return {reject: true};
    case 'promise': return Promise.resolve({images}) as never;
    case 'malformed': return {images, reject: true} as never;
    case 'empty': return {images: []};
    case 'count': return {images: [...images, images[0]!]};
    case 'invalid': return {images: files.map(() => ({src: 'DATA:bad', alt: ''}))};
    case 'throw': throw new Error('paste callback failure');
    case 'move': window.getSelection()?.collapse(root().firstChild, 0); break;
    case 'outside': document.getElementById('outside')!.focus(); window.getSelection()?.selectAllChildren(document.getElementById('outside')!); break;
    case 'replace': commit(model('Host replacement')); break;
    case 'disable': setFlags({...flags, readOnly: true}); break;
    case 'mode': setMode(mode === 'source' ? 'wysiwyg' : 'source'); break;
    case 'dispose': teardown?.(); break;
    case 'echo': commit(clone(current)); break;
    case 'fail': failNextRender(); break;
    case 'prepare-fail': failNextPreparation(); break;
  }
  return {images: files.map((_, i) => ({...images[i % images.length]!}))};
};
const resultHandler = (outcome: ReviewImagePasteOutcome) => {
  logs.push({outcome: clone({...outcome, files: outcome.files.map(x => x.name)}), identities: outcome.files.every((x, i) => x === staged[i]), revision});
  if (flags.resultThrow) throw new Error('result callback failure');
};
const changeHandler = (next: ReviewModel) => {
  logs.push({change: next.text, revision});
  if (flags.replaceOnChange) commit(model('Owner replacement'));
  else if (!flags.decline) commit(next);
  if (flags.changeThrow) throw new Error('change callback failure');
};
const errorHandler = (error: Error) => { logs.push({error: error.message}); if (flags.errorThrow) throw error; };
function failNextRender() {
  const original = document.createElement;
  document.createElement = function (...args: Parameters<Document['createElement']>) {
    if (args[0] === 'span') { document.createElement = original; throw new Error('injected precommit render failure'); }
    return original.apply(document, args);
  } as Document['createElement'];
}
function failNextPreparation() {
  const prototype = Object.getPrototypeOf(lexical().getEditorState());
  const original = prototype.clone;
  prototype.clone = function () { prototype.clone = original; throw new Error('injected preparation failure'); };
}
function App() {
  const [value, setValue] = useState(current);
  const [, refresh] = useState(0);
  const [mounted, setMounted] = useState(true);
  const ref = useRef<ReviewEditorHandle>(null);
  setter = setValue; rerender = () => refresh(x => x + 1);
  teardown = () => flushSync(() => setMounted(false));
  // Retain the last public handle so teardown checks actually call its disposed
  // methods rather than short-circuiting on React's cleared ref.
  queueMicrotask(() => { if (ref.current) handle = ref.current; });
  return <main><h1>Markdown image editor</h1><p>Host-bound previews and atomic selection</p>
    {mounted && <ReviewEditor key={flags.draft as string ?? 'draft'} ref={ref} data-fixture-editor="" value={value}
      {...(flags.noChange ? {} : {onChange: changeHandler})} trackChanges={false} contentMode={mode}
      readOnly={!!flags.readOnly} viewMode={flags.view as 'accept' | 'reject' ?? 'revisions'}
      className="fixture-editor" classNames={classNames}
      {...(flags.noPaste ? {} : {onPasteImages: pasteHandler})}
      {...(flags.noResult ? {} : {onPasteImagesResult: resultHandler})}
      {...(flags.noError ? {} : {onError: errorHandler})}
      {...(flags.omitPreviews ? {} : {imagePreviews: previews})} />}
    <div id="outside" contentEditable suppressContentEditableWarning>Outside editor</div>
  </main>;
}
const classNames = {image: 'fixture-image'};
if (surface === 'react') createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
else {
  document.getElementById('root')!.innerHTML = '<main><h1>Markdown image editor</h1><p>Host-bound previews and atomic selection</p><div class="fixture-editor" data-fixture-editor role="textbox" aria-label="Review editor"></div><div id="outside" contenteditable>Outside editor</div></main>';
  adapter = createReviewLexicalAdapter(root(), {
    classNames,
    get onPasteImages() { return flags.noPaste ? undefined : pasteHandler; },
    get onPasteImagesResult() { return flags.noResult ? undefined : resultHandler; },
    onChange: changeHandler,
    onError(error) { if (flags.noError) throw error; errorHandler(error); },
  });
  adapter.setModel(current, mode); teardown = () => adapter?.dispose();
}
// Fixture-only fault and structural controls never enter the package exports.
const lexical = () => (root() as HTMLElement & {__lexicalEditor: LexicalEditor}).__lexicalEditor;
let imagePrototype: {getImage(): ReviewImage} | undefined;
let originalImageRead: (() => ReviewImage) | undefined;
const fixture = {
  runtime: {react: reactVersion, reactDOM: reactDOMVersion},
  get ready() { return surface === 'imperative' || handle !== null; },
  get value() { return clone(current); }, get logs() { return clone(logs); },
  get mode() { return mode; }, get images() { return images; },
  resetLogs() { logs.length = 0; },
  load(text: string) { commit(model(text)); }, loadModel(next: ReviewModel) { commit(next); },
  modeTo: setMode, flags: setFlags,
  callbacks() { revision += 1; render(); },
  echo() { commit(clone(current)); },
  insert(value: readonly ReviewImage[]) { return surface === 'react' ? handle?.insertImages(value) : adapter?.insertImages(value); },
  inspect(text: string) { return surface === 'react' ? handle!.inspectMarkdown(text) : adapter!.inspectMarkdown(text); },
  range() { return surface === 'react' ? handle?.getSelectionRange() : adapter?.readModelSelectionRange(); },
  format(kind: 'code' | 'block') {
    const command = kind === 'code' ? {action: 'inline' as const, prefix: '`', suffix: '`', richFormat: 'code' as const} : {action: 'block' as const, prefix: '```', suffix: '```', richBlock: 'code' as const};
    if (surface === 'react') handle?.applyMarkdownFormat(command); else adapter?.applyMarkdownFormat({...command, mode});
  },
  previews(entries: [string, string][]) { previews = new Map(entries); if (surface === 'react') render(); else adapter?.setImagePreviews(previews); },
  select(start: number, end = start, backward = false) {
    const element = root(); element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest('[data-critrev-image]')) return NodeFilter.FILTER_REJECT;
        return node.nodeType === Node.TEXT_NODE || (node as Element).matches('[data-critrev-image], br')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes: Node[] = []; let next: Node | null;
    while ((next = walker.nextNode())) nodes.push(next);
    const at = (offset: number): [Node, number] => {
      for (const node of nodes) {
        const length = node.nodeType === Node.TEXT_NODE ? (node as Text).length : 1;
        if (offset <= length) return node.nodeType === Node.TEXT_NODE ? [node, offset]
          : [node.parentNode!, Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode) + (offset > 0 ? 1 : 0)];
        offset -= length;
      }
      return [element, element.childNodes.length];
    };
    const [a, ao] = at(backward ? end : start), [b, bo] = at(backward ? start : end);
    window.getSelection()!.setBaseAndExtent(a, ao, b, bo);
    document.dispatchEvent(new Event('selectionchange'));
  },
  paste(count = 2, type = 'image/png') {
    const data = new DataTransfer();
    for (let i = 0; i < count; i++) data.items.add(new File(['bytes'], `clipboard-${i}.png`, {type}));
    data.setData('text/plain', 'DUPLICATE'); data.setData('text/html', '<b>DUPLICATE</b>');
    const event = new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true});
    root().dispatchEvent(event); logs.push('return'); return event.defaultPrevented;
  },
  htmlPaste() { const data = new DataTransfer(); data.setData('text/html', '<img src="https://unbound.invalid/leak.png" alt="external">'); root().dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true})); },
  createPeer(text = 'Peer draft') {
    peerRoot = document.createElement('div'); peerRoot.dataset.peerEditor = ''; document.body.append(peerRoot);
    peerAdapter = createReviewLexicalAdapter(peerRoot, {onChange(value) { peerAdapter!.setModel(value, 'wysiwyg'); }});
    peerAdapter.setModel(model(text), 'wysiwyg');
  },
  selectPeerEnd() { peerAdapter!.restoreModelSelectionOffset(peerAdapter!.getModel().text.length); },
  peerValue() { return peerAdapter!.getModel(); },
  disposePeer() { peerAdapter!.dispose(); peerRoot!.remove(); },
  insertPeer() { return peerAdapter!.insertImages(images); },
  equalModelStructure() {
    lexical().update(() => {
      const block = $createParagraphNode().append($createTextNode('a'), $createLineBreakNode(), $createLineBreakNode(), $createTextNode('b'));
      $getRoot().clear().append(block); block.selectEnd();
    }, {discrete: true});
  },
  imageProjectionFault(enabled: boolean) {
    if (!imagePrototype) {
      const image = Array.from(lexical().getEditorState()._nodeMap.values()).find(node => node.getType() === 'review-image');
      if (!image) throw new Error('Projection fault needs an image before deletion.');
      imagePrototype = Object.getPrototypeOf(image) as typeof imagePrototype;
      originalImageRead = imagePrototype!.getImage;
    }
    imagePrototype!.getImage = enabled ? function (this: {getImage(): ReviewImage}) { return {...originalImageRead!.call(this), src: 'mismatching.png'}; } : originalImageRead!;
  },
  failNextRender, dispose() { teardown?.(); },
};
Object.assign(window, {fixture});
export type ImageFixture = typeof fixture;

declare global { interface Window {fixture: ImageFixture} }
