# CriticMarkup Lexical Review Editor Consolidated Plan

Status: Draft for review  
Date: 2026-07-02  
Supersedes: `docs/lexical-markdown-review-editor-spec.md` and `criticmarkup-lexical-adaptation-proposal.md` as the working implementation plan

## Summary

Build the review editor on Lexical, not on a custom `contenteditable` surface and not on CriticMarkup-as-live-editor-text.

CriticMarkup remains the durable markdown boundary format:

- Input to the editor is `review.critic.md`.
- Output from the editor is `reviewed.critic.md`.
- Final output accepts all remaining additions, deletions, and substitutions while preserving comments when requested.

Inside the editor, the source of truth is a purpose-built review model and Lexical editor state. CriticMarkup is parsed at import and serialized at export. It must not be rendered, hidden, or edited as literal syntax in rich text mode.

The `Fevol/obsidian-criticmarkup` project should influence range semantics, edit edge cases, comment-thread behavior, metadata conventions, and tests. It should not be ported as the editor foundation because it is built around CodeMirror, Obsidian, Svelte UI, and live markdown source decorations.

## Non-Negotiable Decisions

1. **Lexical is the editor engine.**
   The current demo `contenteditable` implementation must be replaced with a real Lexical editor instance.

2. **CriticMarkup is boundary syntax only.**
   Rich text editing must not contain CriticMarkup delimiters in the live editable document.

3. **The internal model is editor-agnostic.**
   Core review logic lives outside React, outside Lexical, and outside the DOM. Lexical projects this model into editable state.

4. **A user-visible suggestion is an atomic review unit.**
   A substitution like `this {~~is **a great idea** for us.~>**great** for us~~}` is one suggestion even though it crosses markdown formatting boundaries.

5. **Phone UX is first-class.**
   The review rail becomes a bottom sheet or stacked panel on phone widths. All core actions must be reachable without a desktop sidebar.

6. **Testing must drive the editor replacement.**
   Unit tests cover model operations. Playwright tests cover real browser typing, deletion, paste, selection, comments, accept/reject, and mobile layout.

## Sources Reviewed

- Existing local spec: `docs/lexical-markdown-review-editor-spec.md`
- Adaptation proposal: `criticmarkup-lexical-adaptation-proposal.md`
- Local implementation: current `ReviewModel`, CriticMarkup parser/serializer/finalizer, demo, and Playwright tests
- External reference: `Fevol/obsidian-criticmarkup` at commit `7888c748640a1d4a76d09e84666f85765d80b2ed`
- External parser package: `@fevol/lang-criticmarkup@2.1.0`
- Lexical vanilla docs: `createEditor(...)`, `editor.setRootElement(...)`, update listeners, commands, and editor state

## What To Borrow From Obsidian CriticMarkup

Borrow concepts and tests, not the implementation architecture.

Useful concepts:

- Typed range semantics for addition, deletion, substitution, highlight, and comment.
- Accept/reject behavior per range type.
- Substitution old/new parts as one logical range.
- Comment replies attached to a base range as a thread.
- Metadata fields for author, time, done/completed, style, and color.
- Cursor and edit edge cases around adjacent ranges, empty ranges, and substitutions.
- Annotation review view patterns: quick actions, filtering by type/author/date/search, active range focus.

Do not borrow directly:

- CodeMirror `transactionFilter` implementation.
- CodeMirror decoration strategy that hides literal CriticMarkup syntax.
- Obsidian workspace/menu/vault integration.
- Svelte UI components.
- IndexedDB vault-wide cache implementation, except as future inspiration for multi-document indexing.

Parser position:

- `@fevol/lang-criticmarkup` is a Lezer/CodeMirror grammar with a small public API.
- It may be useful for validation and parser parity tests.
- It should not be a hard runtime dependency for the Lexical editor until measured.
- The local parser remains the default boundary parser for now.
- Add a parser adapter interface so a Lezer-backed parser can be tested later without changing editor code.

## Product Pipeline

### Stage 1: Before/After To CriticMarkup

Inputs:

- `before.md`
- `after.md`

Output:

- `review.critic.md`

Responsibilities:

- Normalize line endings and stable whitespace policy.
- Align markdown blocks and inline spans.
- Produce readable CriticMarkup suggestions:
  - Addition: `{++new++}`
  - Deletion: `{--old--}`
  - Substitution: `{~~old~>new~~}`
- Prefer one logical human change as one marker.
- Expand edits across markdown delimiters when needed so markers do not split syntax unsafely.
- Keep MVP suggestions inside a single markdown block.

Current implementation is dependency-free and partial. It should be replaced or augmented later with markdown-aware AST matching, but it already proves the formatted-boundary substitution requirement.

### Stage 2: Lexical Review Editor

Input:

- `review.critic.md`

Output:

- `reviewed.critic.md`

Surfaces:

- Stage 2.1: Raw editor input, read/write textarea for demo loading.
- Stage 2.2: Lexical review editor with inline suggestions/comments and review controls.
- Stage 2.3: Raw editor output generated from the review model.

Rules:

- Import parses CriticMarkup into a review model, then materializes Lexical editor state.
- Rich text mode edits Lexical nodes and the review model, not CriticMarkup text.
- Markdown source mode shows serialized CriticMarkup and is initially read-only when unresolved suggestions or comments exist.
- Plain text mode is read-only.
- Accepted-by-default suggestions can remain as CriticMarkup in `reviewed.critic.md` for the finalizer.
- Rejected suggestions are resolved before serialization:
  - Rejected addition emits nothing.
  - Rejected deletion emits old text as normal markdown.
  - Rejected substitution emits old text as normal markdown.
- New reviewer edits are suggestions when Track Changes is on, even if the input had no suggestions.
- New reviewer edits are hard changes only when Track Changes is off.

### Stage 3: Finalizer

Input:

- `reviewed.critic.md`

Outputs:

- `final.md`
- `final-clean.md`

Rules:

- `{++new++}` becomes `new`.
- `{--old--}` becomes empty text.
- `{~~old~>new~~}` becomes `new`.
- Point comments are preserved in `final.md`.
- Range comments are preserved in `final.md`.
- Comments are stripped in `final-clean.md`.
- Bare highlights are stripped by default unless a future output policy preserves them.

## Architecture

### Layer 1: Boundary CriticMarkup API

Keep the public core API stable:

- `parseCriticMarkup`
- `serializeCriticMarkup`
- `criticMarkupToReviewModel`
- `reviewModelToCriticMarkup`
- `finalizeCriticMarkup`
- `finalizeReviewModel`
- `beforeAfterToCriticMarkup`
- `listReviewChanges`
- `resolveReviewModelChange`

These APIs should not depend on Lexical.

### Layer 2: Review Range Model

The current offset model is the correct direction but needs to become richer.

Recommended internal shape:

```ts
type ReviewDocument = {
  text: string;
  suggestions: ReviewSuggestion[];
  annotations: ReviewAnnotation[];
  threads: ReviewThread[];
  metadata: ReviewDocumentMetadata;
};

type ReviewSuggestion = {
  id: string;
  type: 'addition' | 'deletion' | 'substitution';
  state: 'pending' | 'accepted' | 'rejected';
  source: 'critic-markup' | 'reviewer-edit';
  oldRange?: ReviewRange;
  newRange?: ReviewRange;
  groupId?: string;
  createdBy?: UserRef;
  createdAt?: string;
  metadata?: ReviewMetadata;
};

type ReviewAnnotation = {
  id: string;
  type: 'comment' | 'highlight';
  state: 'open' | 'resolved' | 'deleted';
  range: ReviewRange;
  threadId?: string;
  color?: string;
  quote?: string;
  metadata?: ReviewMetadata;
};

type ReviewThread = {
  id: string;
  anchorId: string;
  messages: ReviewCommentMessage[];
};

type ReviewRange = {
  start: number;
  end: number;
};
```

Required model operations:

- `acceptSuggestion(document, id)`
- `rejectSuggestion(document, id)`
- `acceptAllSuggestions(document)`
- `rejectAllSuggestions(document)`
- `insertTrackedText(document, offset, text, actor)`
- `deleteTrackedRange(document, range, actor)`
- `replaceTrackedRange(document, range, text, actor)`
- `addRangeComment(document, range, body, actor)`
- `addPointComment(document, offset, body, actor)`
- `addHighlight(document, range, color, actor)`
- `splitRange(document, id, offset)`
- `mergeAdjacentCompatibleSuggestions(document)`
- `serializeReviewDocumentToCriticMarkup(document)`
- `parseCriticMarkupToReviewDocument(markdown)`

Range model invariants:

- Ranges are over model text, not CriticMarkup source text.
- Suggestions and annotations are independent dimensions.
- A comment can overlap part of an addition, deletion, or substitution.
- One substitution suggestion owns both old and new ranges.
- Point comments are zero-width annotations.
- IDs are stable across import, edit, accept/reject, and export when possible.

### Layer 3: Lexical Projection

Use vanilla Lexical initially so the editor is not React-specific. A React wrapper can be added later if the product host is React.

Lexical setup:

- Use `createEditor(...)`.
- Attach the root with `editor.setRootElement(renderedReviewElement)`.
- Register nodes, commands, update listeners, and history.
- The demo should assert that the editor is Lexical-backed, for example via a stable `data-editor-engine="lexical"` attribute plus behavior tests.

Initial packages:

- `lexical`
- `@lexical/rich-text`
- `@lexical/history`
- `@lexical/selection`
- `@lexical/utils`
- `@lexical/markdown` when markdown shortcut/import/export work starts
- `@lexical/mark` if using Lexical `MarkNode` for comments/highlights

Avoid `@lexical/react` in the core implementation unless the UI shell later requires it.

Projection strategy:

- Normal text and markdown blocks become normal Lexical nodes.
- Suggestions are represented as custom inline Lexical nodes or text nodes with suggestion metadata.
- Substitutions use one suggestion ID across old and new rendered parts.
- Comments and highlights use mark-style metadata so they can overlap suggestions.
- Lexical state stores in-session structure; the durable export is CriticMarkup.

Recommended node strategy:

- `ReviewSuggestionNode`
  - Inline element node.
  - Stores `suggestionId` and `part: 'old' | 'new'`.
  - Renders as `del` for old/deletion text and `ins` for new/addition text.
  - Is editable text content, not a non-editable control block.
- `ReviewAnnotationMark`
  - Use Lexical mark support if it fits vanilla usage.
  - Otherwise use a small custom inline mark node that stores annotation IDs.
  - Must allow overlapping annotations and suggestions.
- Point comments
  - Render as inline icon decorators or inline element nodes at an offset.
  - The icon is not the comment body.
  - Range comments do not render a separate icon; the highlight is the affordance.

Lexical update flow:

1. Import CriticMarkup into `ReviewDocument`.
2. Build Lexical editor state from `ReviewDocument`.
3. On user updates, derive a logical edit operation from Lexical state and selection.
4. Apply that operation to `ReviewDocument`.
5. Project changed review ranges back into Lexical only when needed.
6. Serialize `ReviewDocument` to update raw output panels.

Avoid walking rendered DOM as the authoritative model. DOM reads may be used only for UI positioning.

### Layer 4: Review UI

Desktop:

- Main editable document column.
- Review rail below the editor in the current demo; right rail can be reintroduced later for wider production layout.
- Inline active suggestion highlight.
- Floating accept/reject controls near selected suggestion.
- Comment popover for point and range comments.

Phone:

- Single document column.
- Suggestions/comments below editor or in bottom sheet.
- Sticky bottom controls for previous, next, accept, reject, comment, and view mode.
- Long-touch selection opens comment composer.
- Active suggestion/card stays visible above the keyboard/bottom sheet.

Controls:

- View mode behind eye icon:
  - Show revisions.
  - Preview reject all.
  - Preview accept all.
- Summary behind info icon.
- Suggestions pane header: `Changes`.
- Each change card describes:
  - `"foo" deleted`
  - `"bar" added`
  - `"foo" changed to "bar"`
- Cards support accept/reject.
- Active inline suggestion highlights the matching card.

## Track Changes Semantics

### Insertion

When Track Changes is on:

- Typing at a collapsed selection creates or extends an addition suggestion.
- Adjacent compatible additions by the same actor should merge.
- Editing inside an existing addition updates that same suggestion.
- Output serializes as `{++new++}` until accepted/rejected/finalized.

### Deletion

When Track Changes is on:

- Backspace/delete creates a deletion suggestion instead of removing text.
- Deleting inside an existing addition may hard-remove from that addition because it is not yet accepted document text.
- Deleting inside an existing deletion updates the deletion suggestion text.
- Output serializes as `{--old--}` until accepted/rejected/finalized.

### Replacement

When Track Changes is on:

- Replacing selected text creates one substitution when representable in one markdown block.
- Output serializes as `{~~old~>new~~}`.
- If the replacement crosses unsupported structural boundaries, fallback to grouped deletion/addition suggestions.
- A formatted-boundary replacement remains one review card when the CriticMarkup marker is one substitution.

### Editing Existing Suggestions

Rules to implement and test:

- Current actor editing their own addition changes that addition.
- Current actor editing their own deletion changes that deletion text.
- Editing someone else's pending suggestion should either:
  - create a nested/new suggestion, or
  - require accept/reject first.
- MVP decision: allow only simple same-author edits inside pending suggestions; otherwise create a new adjacent suggestion.

### Accept/Reject

Accept/reject operations must:

- Run inside a Lexical update tagged as review operation.
- Not be captured as new tracked changes.
- Update both Lexical state and the review model.
- Preserve undo/redo as one coherent action.
- Keep raw output synchronized.

## Comments And Highlights

Point comment:

```markdown
Text here{>>comment body<<}.
```

Range comment:

```markdown
{==selected text==}{>>comment body<<}
```

Highlight:

```markdown
{==selected text==}
```

Rules:

- Range comments render as highlighted text only; no separate inline icon.
- Point comments render as a small inline comment icon.
- Clicking a point icon opens the comment overlay.
- Clicking a range comment highlight opens the comment overlay or focuses the thread.
- Comments may attach to suggestions.
- A comment can overlap only part of an addition/deletion/substitution in the internal model.
- CriticMarkup serialization must degrade unsupported overlaps predictably:
  - Prefer exact range comment when representable.
  - Use point comments at nearby stable offsets when overlapping ranges cannot be serialized without ambiguity.

Thread model:

- Preserve simple imported comment body as the first message.
- Support replies in UI.
- MVP serialization can summarize thread messages into one CriticMarkup comment body.
- Future metadata syntax can preserve author/time/reply structure.

## Markdown And Formatting Boundary Behavior

The editor must be aware that markdown formatting is not the same dimension as suggestions/comments.

Example:

```markdown
old: this is **a great idea** for us.
new: this **great** for us
```

Preferred CriticMarkup:

```markdown
this {~~is **a great idea** for us.~>**great** for us~~}
```

Rules:

- The suggestion remains one substitution.
- Rich text rendering shows old part as deletion styling and new part as addition styling.
- The serializer preserves valid markdown in old and new payloads.
- Edits that cross bold/italic/code/link boundaries should expand to safe markdown spans rather than split delimiters.
- Lexical formatting nodes are projected to markdown during serialization; they are not CriticMarkup syntax.

## Parser And Serializer Strategy

Immediate:

- Keep current local parser/serializer as default.
- Expand tests before replacing parser internals.
- Add an adapter boundary:

```ts
type CriticMarkupParserAdapter = {
  parse(input: string): ParsedCriticMarkupDocument;
  serialize(document: ParsedCriticMarkupDocument): string;
};
```

Future:

- Add optional Lezer adapter using `@fevol/lang-criticmarkup`.
- Run both adapters over shared fixtures.
- Compare:
  - valid CriticMarkup
  - escaped delimiters
  - malformed markers
  - adjacent comments
  - empty ranges
  - substitutions
  - metadata
- Decide whether Lezer becomes production default, validation-only, or unused.

Known parser caution:

- The Lezer parser package documents malformed opening marker behavior where an unclosed marker can consume later tokens.
- User-authored markdown needs lenient, loss-minimizing behavior.

## Test Plan

### Unit Tests

Core parser/model tests:

- Addition round trip.
- Deletion round trip.
- Substitution round trip.
- Comment round trip.
- Range comment round trip.
- Comment on part of an addition.
- Point comment at suggestion boundary.
- Escaped delimiters.
- Empty ranges:
  - `{++++}`
  - `{----}`
  - `{~~~>~~}`
- Adjacent ranges:
  - `{++a++}{--b--}`
  - `{++a++}{++b++}`
- Formatted-boundary substitution remains one suggestion.
- Metadata is preserved when present.
- Malformed markers preserve user text rather than dropping content.

Model operation tests:

- Accept/reject one.
- Accept/reject all.
- Insert tracked text into unchanged content.
- Delete tracked range from unchanged content.
- Replace tracked range from unchanged content.
- Edit inside addition.
- Edit inside deletion.
- Edit inside substitution old side.
- Edit inside substitution new side.
- Edit across substitution separator equivalent in the model.
- Merge adjacent compatible suggestions.
- Split incompatible suggestions.
- Comments and highlights shift correctly through insert/delete.

### Playwright Tests

Desktop and mobile:

- Demo shows Stage 2.1, Stage 2.2, Stage 2.3 separately.
- Editor root is Lexical-backed.
- Typing in unchanged text creates an addition suggestion and caret does not jump.
- Backspace creates a deletion suggestion and caret does not jump.
- Typing inside an existing addition extends that suggestion.
- Removing a single character from an addition updates that suggestion.
- Removing a single character from a deletion updates that suggestion.
- Replacing selected text creates one substitution.
- Rejecting a formatted-boundary substitution restores the old formatted text.
- Accepting a formatted-boundary substitution keeps the new formatted text.
- View modes:
  - show revisions
  - preview reject all
  - preview accept all
- Inline accept/reject controls work from cursor inside suggestion.
- Active suggestion card is highlighted when cursor is in suggestion.
- Point comment icon opens overlay.
- Range comment highlight opens overlay.
- Creating a range comment from selection works by context menu and long touch.
- Phone layout puts Changes below editor or in bottom sheet.
- Raw CriticMarkup syntax never appears in rich text editor content after typing.

Negative/guardrail tests:

- Source mode is read-only when unresolved markers exist.
- Programmatic import is not captured as a tracked change.
- Accept/reject is not captured as a tracked change.
- Paste creates one addition or replacement suggestion, not hard text.
- Empty document with Track Changes on can still create first suggestion.

### Upstream-Inspired Cursor Fixtures

Port representative cases from `obsidian-criticmarkup/tests/cursor_movement.test.ts` into unit and Playwright coverage:

- `uv. wx yz`
- `{++x++}`
- `{++.++}`
- `{++ ++}`
- `x{++y++}z`
- `uv{++w++}x{++y++}z`
- `uv{++w++}{++y++}z`
- `ab{++cd++}{--     --}ef`
- `ab{++cd++}{++++}{--......--}ef`
- `x{~~y~>z~~}u`
- `x{~~y~>z~~}{~~v~>w~~}ll`
- `x{~~~>~~}u`

## Implementation Phases

### Phase 0: Clean Up Demo Direction

Goal: stop investing in the custom DOM editor except as a throwaway baseline.

Tasks:

- Mark the current custom `contenteditable` demo as temporary.
- Keep current tests as behavior requirements.
- Do not add more DOM-to-model features except to unblock migration.

Exit criteria:

- Team agrees the next editor implementation is Lexical.

### Phase 1: Strengthen Review Range Model

Goal: make review operations robust before tying them to Lexical.

Tasks:

- Add parser adapter interface.
- Extend `ReviewModel` toward `ReviewDocument`.
- Add typed range helpers inspired by upstream.
- Add operation tests for accept/reject, tracked insert/delete/replace, comments, and range shifting.
- Add upstream-inspired fixtures.

Exit criteria:

- Existing public API still passes.
- New model operations pass without Lexical.
- Parser behavior differences are documented.

### Phase 2: Minimal Lexical Shell

Goal: replace the editor surface with Lexical.

Tasks:

- Install Lexical dependencies cleanly.
- Create vanilla Lexical editor instance.
- Attach it to the demo `rendered-review` root.
- Import `ReviewDocument` into Lexical state.
- Render additions/deletions/substitutions/comments/highlights.
- Export Lexical/review state back to CriticMarkup.
- Add Playwright assertion that the editor is Lexical-backed.

Exit criteria:

- No custom authoritative DOM-to-model reconstruction.
- Existing demo behavior still passes.
- Raw CriticMarkup does not appear in rich text mode.

### Phase 3: Lexical Track Changes

Goal: tracked editing works through Lexical commands/update handling.

Tasks:

- Intercept insert/delete/replace flows while Track Changes is on.
- Tag imports and review operations so they are not tracked.
- Preserve selection and history.
- Merge compatible additions.
- Handle edit inside existing suggestions.
- Add paste coverage.

Exit criteria:

- Real keyboard Playwright tests pass on desktop and mobile.
- Typing/backspace/paste produce suggestions, not hard changes.
- Caret behavior is stable.

### Phase 4: Comments And Review Rail

Goal: production review interactions.

Tasks:

- Implement comment creation from selection.
- Implement point comment icons and range comment highlights.
- Implement comment overlay/thread view.
- Implement suggestion cards and active-card sync.
- Implement mobile bottom sheet or below-editor Changes panel.
- Add filters later if needed: type, author, date, search.

Exit criteria:

- Comments can overlap suggestions in the model.
- Range comments serialize correctly.
- Point comments serialize correctly.
- Phone and desktop review flows pass.

### Phase 5: Markdown Source And Plain Text Modes

Goal: safe alternate views.

Tasks:

- Add read-only Markdown Source mode for unresolved review docs.
- Add editable source mode only for safe documents or explicit warning path.
- Add Plain Text read-only view.
- Add copy behavior that excludes hidden review syntax from rich text selection.

Exit criteria:

- Source mode round-trips when allowed.
- Source mode does not silently detach comments or suggestions.
- Plain text view is stable and accessible.

### Phase 6: Smart Diff Upgrade

Goal: improve `before.md` plus `after.md` conversion quality.

Tasks:

- Add markdown AST block matching.
- Add inline token diffing.
- Add move candidates.
- Improve formatting-boundary expansion.
- Add table/list/code-specific rules.

Exit criteria:

- Better human review granularity.
- Existing one-marker formatted-boundary substitution behavior remains.

## Dependency Policy

Immediate Lexical dependencies are acceptable because Lexical is the required editor engine.

Do not add `@fevol/lang-criticmarkup` as a production dependency yet.

Recommended sequence:

1. Add Lexical dependencies for the editor.
2. Add upstream-inspired fixtures manually.
3. Add parser adapter interface.
4. Optionally spike Lezer parser in a branch or behind adapter tests.
5. Decide with data whether to keep it.

If any upstream source code is copied rather than reimplemented, preserve MIT license attribution. Prefer reimplementation from behavior and tests.

## Open Decisions

1. Should metadata be MVP behavior or parse-and-preserve only?
2. Should same-author edits inside pending suggestions merge automatically?
3. What is the product rule for editing someone else's pending suggestion?
4. Should markdown source mode ever be editable with unresolved review markers?
5. How should overlapping comments that CriticMarkup cannot represent exactly degrade on export?
6. Should review rail be below-editor by default at all widths, or right rail on wide screens?
7. Should accepted suggestions remain as CriticMarkup until finalization, or unwrap immediately in `reviewed.critic.md`?

## Immediate Next Step

Proceed with Phase 1 and Phase 2 together in a narrow vertical slice:

1. Add the parser/model operation tests needed for the current demo and upstream-inspired edge cases.
2. Install Lexical cleanly.
3. Replace `rendered-review` with a vanilla Lexical editor.
4. Keep the raw input/output/finalizer panels so every step is visible.
5. Make Playwright prove the editor is Lexical-backed and the current desktop/mobile workflows still pass.

