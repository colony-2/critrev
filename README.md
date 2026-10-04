# critrev

Unstyled React components and a framework-independent core for reviewing Markdown. Turn before/after documents into CriticMarkup suggestions, edit in source or WYSIWYG mode, attach comments, and accept or reject changes.

The application owns the layout, CSS, toolbar, comment composer, and persistence. The package imports no stylesheets and adds no global styles.

Repository: [colony-2/critrev](https://github.com/colony-2/critrev).

## Install

Once published to npm:

```sh
npm install critrev
```

React apps also need `react` and their renderer (normally `react-dom`). React 18 and 19 are supported. React is an optional peer dependency so core-only consumers do not need it. This is an ESM package with TypeScript declarations; use TypeScript 5.2+ with `moduleResolution: "bundler"` or `"nodenext"`.

To consume this checkout before publication:

```sh
npm ci
npm pack
# In your application, install the resulting tarball:
npm install /path/to/critrev/critrev-0.1.0.tgz
```

`npm pack` builds the distributable automatically. Installing a tarball exercises the same exports as an npm release.

## Entry points

| Import | Contents |
| --- | --- |
| `critrev` | Pure Markdown diff, CriticMarkup parsing/serialization, review models, comment and suggestion operations. No React, Lexical, or browser imports. |
| `critrev/react` | `ReviewEditor`, `ReviewChanges`, `useReview`, and their TypeScript types. |
| `critrev/lexical` | Imperative `createReviewLexicalAdapter` for non-React integrations. |

## Diff → suggestions and comments

Use the core on the server, in a worker, or independently of the editor:

```ts
import {
  addReviewComment,
  beforeAfterToReviewModel,
  finalizeReviewModel,
  reviewModelToCriticMarkup,
} from 'critrev';

let review = beforeAfterToReviewModel('Hello team.', 'Hello whole team.');
review = addReviewComment(review, {
  start: 0,
  end: 5,
  value: 'Should we change the greeting?',
});

const criticMarkup = reviewModelToCriticMarkup(review);
// {==Hello==}{>>Should we change the greeting?<<} {++whole ++}team.
const acceptedMarkdown = finalizeReviewModel(review, {preserveComments: false});
// Hello whole team.
```

For the text-only pipeline, use `beforeAfterToCriticMarkup(before, after)`, `parseCriticMarkup`, `serializeCriticMarkup`, `listCriticMarkupChanges`, `resolveCriticMarkupChange`, and `finalizeCriticMarkup`.

A `ReviewModel` contains `text`, `suggestions`, `comments`, and `highlights`. Ranges are zero-based, end-exclusive UTF-16 offsets into **`model.text`**, which includes both the old and new text of unresolved substitutions. They are not offsets into the serialized CriticMarkup or the accepted document. Point comments have `start === end`.

Persist the complete `ReviewModel` as JSON to retain IDs and annotation data. Use `criticMarkupToReviewModel(text)` to load CriticMarkup; parsing generates new positional IDs, so IDs do not survive a text serialization round trip. `finalizeReviewModel` accepts all remaining suggestions and preserves comments by default; pass `{preserveComments: false}` for clean Markdown.

## React editor

```tsx
'use client';

import {useState} from 'react';
import {beforeAfterToReviewModel} from 'critrev';
import {
  ReviewChanges,
  ReviewEditor,
  useReview,
  type ReviewContentMode,
  type ReviewViewMode,
} from 'critrev/react';

const initialReview = beforeAfterToReviewModel(
  'Please ship the draft.',
  'Please ship the polished draft.',
);

export function DocumentReview() {
  const review = useReview({defaultValue: initialReview});
  const [contentMode, setContentMode] = useState<ReviewContentMode>('wysiwyg');
  const [viewMode, setViewMode] = useState<ReviewViewMode>('revisions');

  return (
    <section>
      <button onClick={() => setContentMode(contentMode === 'source' ? 'wysiwyg' : 'source')}>
        Toggle source / WYSIWYG
      </button>
      <select aria-label="Review view" value={viewMode}
        onChange={event => setViewMode(event.target.value as ReviewViewMode)}>
        <option value="revisions">Revisions</option>
        <option value="accept">Accept preview</option>
        <option value="reject">Reject preview</option>
      </select>

      <ReviewEditor
        value={review.value}
        onChange={review.setValue}
        contentMode={contentMode}
        viewMode={viewMode}
        className="document-editor"
        aria-label="Document review"
      />

      <aside>
        <ReviewChanges
          value={review.value}
          empty={<p>No pending changes or comments.</p>}
          renderChange={change => (
            <article>
              <del>{change.oldValue}</del> <ins>{change.newValue}</ins>
              <button onClick={() => review.resolveChange(change.id, 'accept')}>Accept</button>
              <button onClick={() => review.resolveChange(change.id, 'reject')}>Reject</button>
            </article>
          )}
          renderComment={comment => (
            <article>
              <p>{comment.value}</p>
              <button onClick={() => review.removeComment(comment.id)}>Delete comment</button>
            </article>
          )}
        />
      </aside>
      <pre>{review.criticMarkup}</pre>
    </section>
  );
}
```

`ReviewChanges` returns a fragment in document order. The render callbacks own every card, button, wrapper and style. Omit `renderComment` to render only suggestions.

### Editor props and modes

| Prop | Default | Behavior |
| --- | --- | --- |
| `value` | Required | Controlled `ReviewModel`. Treat models as immutable. |
| `onChange(model)` | — | Receives edits. Update `value` synchronously to retain them; persist asynchronously. Without this callback, the surface is read-only. |
| `contentMode` | `'wysiwyg'` | `'source'` shows Markdown syntax with review annotations; `'wysiwyg'` renders supported Markdown. Source mode is not a raw CriticMarkup textarea. |
| `viewMode` | `'revisions'` | `'revisions'`, `'accept'`, or `'reject'`. Accept/reject modes are read-only previews and never modify `value`. |
| `readOnly` | `false` | Disables text editing and comment requests. |
| `trackChanges` | `true` | Edits to unchanged text create suggestions. `false` applies edits directly. Editing inside an existing suggestion updates it. |
| `onCommentRequest(range, event)` | — | Requests your comment UI on context menu / Shift+F10. `range` uses source offsets. |
| `className`, `style`, DOM/ARIA props | — | Applied to the editor root. Children and `contentEditable` are owned by the editor. |
| `classNames` | See below | Overrides annotation classes. |
| `theme` | — | Lexical theme classes for paragraphs, headings, text formats, lists, links, etc. |
| `renderCommentAnchor(element, comment)` | — | Replace the contents of the point-comment button with your own icon or text. Keep the button itself. |
| `namespace` | `'critrev'` | Lexical namespace. Use distinct values when incompatible editors share a page. |
| `onError(error)` | Throws | Handles Lexical errors. |

Keep `theme`, `classNames`, and `renderCommentAnchor` stable (module constants or memoized values). Changing them or `namespace` recreates the editor. Every editor instance has independent state and cleans up on unmount, including React Strict Mode remounts.

`critrev/react` is a client entry point. In frameworks with server components, put interactive consumers behind `'use client'`. Server rendering produces the accessible editor shell; Lexical populates it after mount. Render a separate document preview when server-rendered document content is required.

### State and actions

`useReview({defaultValue})` owns local state; `defaultValue` is read only on mount. To load a new document, call `setValue(model)`, `resetFromDiff(before, after)`, or remount with a different React `key`.

For state owned by your application:

```tsx
const [value, setValue] = useState(initialReview);
const review = useReview({value, onChange: setValue});
// Or use <ReviewEditor value={value} onChange={setValue} /> directly.
```

The hook returns:

- `value`, `changes`, `comments`, and `criticMarkup`.
- `setValue(modelOrUpdater)` and `resetFromDiff(before, after)`.
- `resolveChange(suggestionId, 'accept' | 'reject')` and `resolveAll(decision)`.
- `addComment({start, end, value, id?})`, `updateComment(id, text)`, and `removeComment(id)`.
- `finalize({preserveComments?})` to derive accepted Markdown without mutating state.

Core equivalents include `addReviewComment`, `updateReviewComment`, `removeReviewComment`, `listReviewChanges`, `resolveReviewModelChange` (takes a **change index**, not an ID), and `reviewModelForView`.

### Selection comments and formatting

Capture the selection before focusing your composer. In the component above, add a ref and pending selection state:

```tsx
import {useRef, useState} from 'react';
import type {ReviewRange} from 'critrev';
import type {ReviewEditorHandle} from 'critrev/react';

const editorRef = useRef<ReviewEditorHandle>(null);
const [pendingRange, setPendingRange] = useState<ReviewRange | null>(null);

// Pass these props to ReviewEditor:
// ref={editorRef}
// onCommentRequest={range => setPendingRange(range)}

// Render a toolbar control:
<button
  onMouseDown={event => event.preventDefault()}
  onClick={() => setPendingRange(editorRef.current?.getSelectionRange() ?? null)}
>
  Comment
</button>

// When your composer submits its text:
if (pendingRange) {
  review.addComment({...pendingRange, value: 'Please clarify this.'});
  setPendingRange(null);
}
```

`getSelectionRange()` returns `null` outside the editor or in preview modes. A collapsed selection creates a point comment. Captured ranges belong to the current document; dismiss or recapture the composer if the document changes before submission. Use `data-comment-id` / `data-suggestion-id` event targets to implement your own hover or click panels. Your application also owns mobile gestures, dialogs and deletion confirmation.

The ref also provides `focus()` and `applyMarkdownFormat(command)`. Preserve selection with `onMouseDown={event => event.preventDefault()}` on formatting buttons:

```ts
editorRef.current?.applyMarkdownFormat({
  action: 'inline', prefix: '**', suffix: '**', richFormat: 'bold',
});
// The active content mode is applied automatically.
```

Commands support inline wrappers, line prefixes, and rich blocks (`h1`, `h2`, `h3`, `quote`, `code`, `ul`, `ol`, `check`, `hr`). See `ReviewMarkdownFormatCommand` for all fields.

## Styling

No CSS import is required or provided. Native HTML elements retain browser defaults; supply your application's reset if desired. Include whitespace handling for source mode and an icon size for the default point-comment SVG:

```css
.document-editor { white-space: pre-wrap; overflow-wrap: anywhere; }
.document-editor[data-content-mode='source'] { font-family: monospace; }
.document-editor .review-addition { color: #167238; }
.document-editor .review-deletion { color: #a32323; text-decoration: line-through; }
.document-editor .review-range-comment { background: #fff0aa; }
.document-editor .review-highlight { background: #e7dfff; }
.document-editor .comment-anchor svg {
  width: 1em; height: 1em; fill: none; stroke: currentColor;
}
```

Use CSS Modules, utility classes, CSS-in-JS, or ordinary CSS. Annotation classes can be replaced, including with an empty string:

```tsx
const classNames = {
  change: 'app-change',
  addition: 'text-green-700',
  deletion: 'text-red-700 line-through',
  rangeComment: 'bg-yellow-100',
  pointComment: 'app-comment-button',
  highlight: 'app-highlight',
  image: 'app-image',
};
const theme = {paragraph: 'app-paragraph', text: {bold: 'font-bold'}};
// <ReviewEditor ... classNames={classNames} theme={theme} />
```

Default class names are `review-change`, `review-addition`, `review-deletion`, `review-range-comment`, `comment-anchor`, `review-highlight`, and `review-image`.

Stable DOM hooks include root `data-critrev-editor`, `data-content-mode`, `data-view-mode`; suggestion `data-suggestion-id`, `data-suggestion-part` (`old` / `new`), `data-change-kind`; and annotation `data-comment-id`, `data-highlight-id`, `data-critrev-comment-anchor`. These remain available with custom classes. Scope CSS under your root to isolate multiple editors.

## Non-React editor

```ts
import {beforeAfterToReviewModel} from 'critrev';
import {createReviewLexicalAdapter} from 'critrev/lexical';

const editor = createReviewLexicalAdapter(document.querySelector('#editor')!, {
  onChange(model) { /* Store the updated model. */ },
  classNames: {addition: 'my-addition'},
});
editor.setModel(beforeAfterToReviewModel('before', 'after'), 'wysiwyg');
editor.setEditable(true);
// On unmount:
editor.dispose();
```

This low-level adapter reports direct editor snapshots. Use `reconcileReviewEdit(previous, snapshot, selectionOffset)` to track edits as suggestions, and `reviewModelForView` for previews. `readModelSelectionRange()` returns Markdown source offsets; `readSelectionRange()` is the lower-level rendered-text range. `restoreModelSelectionOffset()` restores a source caret. Instantiate only in the browser and always dispose it.

## Scope and limitations

The diff is deterministic and preserves logical formatting-boundary replacements, but is not a full Markdown AST diff. WYSIWYG supports common headings, lists, links, quotes, code and inline formatting; it can normalize Markdown spelling/spacing after edits. It is not a lossless renderer for arbitrary Markdown/HTML, tables or deeply nested structures. Images are represented by their editable alt text and metadata, not fetched previews.

The model can hold richer annotations than the flat CriticMarkup format. Overlapping comments/highlights and comments spanning suggestion boundaries do not serialize losslessly; nested annotations inside suggestions are not fully reconstructed by the parser. Persist model JSON when those cases matter. WYSIWYG displays one comment per text segment. Applications needing collaborative edits, threaded discussions, authorship or conflict resolution should manage those separately.

## Development and release

Use Node 22+ for the development toolchain (the package declares Node 20+).

```sh
npm ci
npm run typecheck
npm test
npm run build:demo
npm run check:package
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright install chromium
npm run test:e2e
npm run dev
```

The original pipeline demo runs at `http://localhost:5173/`; the React consumer example runs at `http://localhost:5173/react.html`. Its [source](demo/src/react-demo.tsx) and [CSS](demo/src/react-demo.css) belong to the application, not the package.

`check:package` installs an actual tarball in a temporary project, checks core imports without React, and typechecks/server-renders React 18 and 19 consumers. CI also runs unit and browser tests. Production builds exclude tests, demos and internal planning documents.

Before a first release, confirm ownership of the npm package name `critrev` and set the intended version. Run the checks above and inspect `npm pack --dry-run`. Publish explicitly from an authorized npm account with `npm publish`; no workflow publishes automatically.

## License

[MIT](LICENSE) © 2026 critrev contributors.
