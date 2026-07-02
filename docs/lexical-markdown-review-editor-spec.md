# Lexical Markdown/Rich Text Review Editor Specification

Status: Draft  
Date: 2026-07-02  
Owner: TBD

## Summary

Build a Lexical-based CriticMarkup review editor. The durable transaction input is still two markdown files, `before.md` and `after.md`, but the before/after diff is a separate preprocessing step that converts those files into CriticMarkup markdown before the editor opens. The core editor then reads CriticMarkup, exposes additions/deletions/substitutions/comments/range comments as rich review UI, and emits CriticMarkup again when editing completes.

The final output pass accepts all remaining CriticMarkup additions, deletions, and substitutions to produce accepted markdown that preserves comments and range comments. Lexical is the interactive editing and review layer, not the canonical storage format. CriticMarkup markdown is the editor boundary format.

## References

- Lexical core concepts: https://lexical.dev/docs/packages/lexical
- Lexical React plugins: https://lexical.dev/docs/react/plugins
- Lexical markdown package: https://lexical.dev/docs/packages/lexical-markdown
- Lexical mark package and `MarkNode`: https://lexical.dev/docs/packages/lexical-mark
- Lexical commands: https://lexical.dev/docs/concepts/commands
- Playground editor composition: https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/Editor.tsx
- Playground markdown mode: https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/ActionsPlugin/index.tsx
- Playground comments plugin: https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/CommentPlugin/index.tsx
- Playground markdown transformers: https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/plugins/MarkdownTransformers/index.ts
- CriticMarkup syntax in MultiMarkdown: https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html
- CriticMarkup overview in Marked 2: https://marked2app.com/help/CriticMarkup.html

## Goals

- Provide a production-quality editor shell based on Lexical with CriticMarkup markdown as the editor input and output.
- Support a separate preprocessing step that accepts exactly two source inputs for each edit cycle:
  - `before.md`: the original markdown at the start of the transaction.
  - `after.md`: the proposed markdown at the end of the transaction.
- Convert `before.md` plus `after.md` into CriticMarkup using markdown-aware matching, not a naive line diff.
- Make the core editor understand CriticMarkup natively at import, editing, and export boundaries.
- Support three document views:
  - Rich Text: primary WYSIWYG editing surface.
  - Markdown Source: CriticMarkup markdown text.
  - Plain Text: read-only text extraction for review, search, copy, and accessibility workflows.
- Support markdown shortcuts in Rich Text mode using Lexical markdown transformers.
- Support inline highlights across selected text ranges.
- Support inline markdown comments anchored to selected text ranges.
- Support track changes represented as CriticMarkup additions, deletions, and substitutions.
- Support accept/reject for a single suggestion and accept/reject all pending suggestions.
- Emit reviewed CriticMarkup from the editor, then produce final markdown by accepting all remaining additions/deletions/substitutions while preserving comments and range comments.
- Keep UI familiar to users of Google Docs, Microsoft Word, Notion, and Linear-style comment/review rails without copying any one product.
- Treat phone layouts as first-class, not a collapsed desktop afterthought.

## Non-goals For MVP

- Full word processor parity.
- Real-time multi-user conflict resolution unless the host app already has collaboration infrastructure.
- Pixel-perfect rendering of every markdown dialect.
- Perfect preservation of arbitrary hand-written HTML or unsupported markdown extensions.
- Arbitrary multi-block inline CriticMarkup spans. MVP comments/suggestions should stay within a paragraph, heading, list item, or table cell.
- Track changes for every possible structural edit in the MVP, such as table reshaping, image replacement, embeds, and page layout changes.

## Product Principles

- CriticMarkup markdown is the source of truth at the editor boundary. Lexical `EditorState` is an in-session projection.
- Each review session is transactional: `before.md` plus `after.md` produce deterministic CriticMarkup before the editor opens.
- A CriticMarkup change is accepted by default unless the reviewer explicitly rejects it.
- Rejected changes must be resolved back into CriticMarkup output so the final accept-all pass cannot accidentally apply them.
- Comments and range comments must serialize back into markdown inline. The editor can hydrate richer UI state from that inline representation.
- Suggestions are first-class review entities with visible inline nodes and in-session metadata.
- Accept/reject operations must be deterministic and undoable.
- Review UI should stay out of the way while writing and become prominent when reviewing.
- Raw markdown editing must never silently discard comments or rejected suggestion state.

## User Experience

### Layout

Use a document editor layout rather than a marketing/editor demo layout.

- Large screen toolbar:
  - Text style controls.
  - Block style dropdown.
  - Link/list/code controls.
  - Highlight and comment buttons.
  - Track Changes toggle.
  - Review controls: Previous, Next, Accept, Reject, Accept All, Reject All.
  - View segmented control: Rich Text, Markdown, Plain Text.
- Large screen document canvas:
  - Centered readable content column.
  - Left margin change bars for suggestions.
  - Inline highlight/comment/suggestion markup.
- Right review rail:
  - Comment threads and suggestion cards.
  - Cards align near their anchor when possible.
  - Active card is emphasized with border, shadow, and matching inline highlight state.
  - Resolved comments collapse into a small resolved section.
- Phone:
  - Primary layout is a single document column with sticky bottom controls.
  - Selection toolbar appears above the keyboard and exposes Comment, Highlight, Accept, Reject, and More.
  - Review cards appear as a bottom sheet with snap points at peek, half, and full height.
  - Previous/Next suggestion controls live in the bottom bar so review can be done one-handed.
  - The active inline mark is always scrolled above the bottom sheet and keyboard.
  - Markdown Source mode uses a full-screen monospaced editor with line wrapping and a compact review-mark legend.

### Comments

Comment behavior should follow common review-tool conventions.

- Selecting text shows a small floating action with comment and highlight options.
- Right-clicking a selection opens the comment composer on pointer devices.
- Long-touching a selection opens the comment composer on phones and touch devices.
- Add Comment opens a compact composer near the selection.
- Submitting creates an inline markdown comment plus hydrated UI state with:
  - Author display.
  - Timestamp.
  - Quoted selected text.
  - First comment body.
  - Reply composer.
  - Resolve and overflow actions.
- Clicking an inline comment mark opens and focuses its thread in the rail.
- Clicking a thread card selects or scrolls to the annotated text.
- Resolved threads remain recoverable and can be reopened.
- Deleting a thread removes its inline comment markup from the markdown output.
- Comment serialization uses CriticMarkup:
  - Point comment: `This needs work{>>clarify this sentence<<}.`
  - Range comment: `{==selected text==}{>>clarify this phrase<<}`
  - Threaded comment in MVP: encode replies inside the comment body with a simple readable convention, for example `Alice: first note | Bob: reply`.
  - Rich thread metadata can be kept in memory for UI during a session, but the markdown output must remain understandable without that metadata.

### Highlights

- Highlighting selected text creates an annotation with a color.
- Default highlight color should be yellow.
- Highlight popover supports color changes and removal.
- A highlight can later be converted into a comment thread without changing the text range.
- Range comments use CriticMarkup highlight syntax plus a comment: `{==selected text==}{>>comment<<}`.
- Bare highlight-only annotations use `{==selected text==}` and are optional.
- Bare highlights are stripped by the default finalizer unless a future `final-with-highlights` policy is added.

### Track Changes

Track Changes is primarily the visual review layer for CriticMarkup change spans.

- Imported suggestions come from CriticMarkup generated by the before/after preprocessor.
- CriticMarkup additions, deletions, and substitutions are pending by default.
- A reviewer can reject individual imported suggestions.
- One CriticMarkup change marker is one user-visible suggestion card and one accept/reject unit, even when it contains mixed formatting.
- A reviewer can also make additional edits during review.
- Additional edits should be tracked as new CriticMarkup suggestions when Track Changes is on, including when the editor initially loaded markdown with no pending suggestions.
- Additional edits should be applied directly when Track Changes is off.
- The editor emits CriticMarkup where rejected changes have already been resolved to their original/no-change form.
- The finalizer accepts every remaining CriticMarkup change marker.

- Insertion suggestion:
  - Inline text appears green.
  - No underline, background, block wrapper, or inserted "from/to" text is added.
  - Hover/click opens suggestion card.
  - Accept may leave `{++new++}` for the finalizer or unwrap it to `new`.
  - Reject removes inserted content from the editor's CriticMarkup output.
- Deletion suggestion:
  - Inline text remains visible with normal text color and a green strikethrough.
  - No background, block wrapper, or additional deletion label is added.
  - Accept may leave `{--old--}` for the finalizer or remove it immediately.
  - Reject restores `old` as normal markdown in the editor's CriticMarkup output.
- Replacement suggestion:
  - Use CriticMarkup substitution syntax: `{~~old~>new~~}`.
  - Render as adjacent deletion and insertion marks only, not as a "old to new" phrase or special block.
  - Accept may leave the substitution for the finalizer or unwrap it to `new`.
  - Reject restores `old` as normal markdown in the editor's CriticMarkup output.
- Move suggestion:
  - MVP may render as deletion plus insertion.
  - Phase 4 can group these into a move card when smart matching has high confidence.
- Review rail cards show:
  - Suggestion type.
  - Author.
  - Relative timestamp.
  - Short quoted context.
  - Accept and Reject buttons.
- Toolbar review controls:
  - Previous Suggestion.
  - Next Suggestion.
  - Accept Current.
  - Reject Current.
  - Accept All.
  - Reject All.
- Accept All and Reject All require confirmation when more than a small threshold is pending, for example more than 10 suggestions.

## View Modes

### Rich Text Mode

Primary editing mode.

- Use `RichTextPlugin` or the current Lexical extension equivalent already adopted by the project.
- Register normal rich text nodes:
  - Paragraph.
  - Heading.
  - Quote.
  - List/ListItem.
  - Link/AutoLink.
  - Code/CodeHighlight.
  - Table only if existing product scope requires it.
  - `MarkNode` for comments and highlights.
  - Custom suggestion node(s) for track changes.
- Enable markdown shortcuts with `MarkdownShortcutPlugin` and the configured transformer set.
- Initial content is synthesized from the CriticMarkup review model. Additions, deletions, substitutions, comments, and range comments are materialized as Lexical nodes/marks.

### Markdown Source Mode

Markdown Source is the CriticMarkup text representation for the active review state.

Use a `CodeNode` with language `markdown` for the source editor, following the upstream playground approach, but convert through the review serializer instead of plain `$convertToMarkdownString` when comments or suggestions are present.

1. Convert the active review model to markdown source.
2. Preserve unresolved comments using CriticMarkup comment and range-comment syntax.
3. Preserve pending suggestions using CriticMarkup addition/deletion/substitution syntax.
4. Let the user edit markdown source only when it can be round-tripped safely.
5. On return to Rich Text, parse markdown plus CriticMarkup back into the review model, then materialize Lexical state.

Safety rules:

- If pending suggestions or unresolved comments exist, Markdown Source defaults to read-only review markup.
- Editable source is allowed when the current document has no pending suggestions or unresolved comments.
- User can choose "Edit source anyway" only after a warning that malformed or moved inline review markup may detach comments or rejected-state tracking.
- Phase 4 can add source edits as a new diff transaction instead of mutating the active review state directly.

Export modes:

- `review-markup`: emit the editor's current CriticMarkup.
- `final-with-comments`: run the finalizer over `review-markup`; accept all remaining change markers and preserve comments/range comments.
- `final-clean`: same as `final-with-comments`, but strip comments/range comments.

### Plain Text Mode

Plain Text is read-only in MVP.

- Generate from the editor state using Lexical text extraction.
- Preserve paragraph/list/code line breaks.
- Provide Copy Text.
- Do not allow direct editing because plain text edits would be lossy for annotations, formatting, and suggestions.

## CriticMarkup Pipeline

The system has three separable stages.

### Stage 1: Before/After To CriticMarkup

This stage runs before the editor opens.

Inputs:

- `before.md`: the original content before the transaction.
- `after.md`: the proposed content after the transaction.

Output:

- `review.critic.md`: markdown plus CriticMarkup additions, deletions, and substitutions.

Pipeline:

1. Normalize line endings, trailing whitespace policy, and frontmatter handling.
2. Parse both files into markdown ASTs with source positions.
3. Run markdown-aware matching to align blocks and inline spans.
4. Serialize the diff as CriticMarkup:
   - Insertions become `{++new++}`.
   - Deletions become `{--old--}`.
   - Simple replacements become `{~~old~>new~~}`.
   - Moves may be represented as deletion plus insertion in MVP.
5. Emit deterministic CriticMarkup so the same inputs produce stable review markup.

### Stage 2: Core CriticMarkup Editor

This is the Lexical editor's boundary contract.

Stage 2 has three explicit surfaces:

- Stage 2.1 Raw Editor Input: the CriticMarkup markdown handed to the editor.
- Stage 2.2 Review Editor: the rich editable surface, suggestion cards, inline accept/reject controls, and comment composer.
- Stage 2.3 Raw Editor Output: the CriticMarkup markdown emitted by the editor after accept/reject decisions, reviewer edits, comments, and range comments.

Input:

- `review.critic.md`.

Output:

- `reviewed.critic.md`.

Import pipeline:

1. Parse CriticMarkup markers before normal markdown inline rendering.
2. Build a review model containing normal markdown plus change/comment/range-comment spans.
3. Parse marker payloads as markdown inline fragments where applicable.
4. Materialize the review model into Lexical nodes:
   - Normal markdown nodes for unchanged content.
   - Suggestion nodes for `{++ ++}`, `{-- --}`, and `{~~ ~> ~~}`.
   - Mark nodes for `{>> <<}` and `{== ==}{>> <<}`.
5. Hydrate the review rail from the suggestion/comment index.

Editor output rules:

- Pending or accepted additions/deletions/substitutions may remain as CriticMarkup because the finalizer will accept them.
- Rejected additions are removed from `reviewed.critic.md`.
- Rejected deletions are restored as plain markdown in `reviewed.critic.md`.
- Rejected substitutions are restored to their original text as plain markdown in `reviewed.critic.md`.
- Direct reviewer edits made with Track Changes off are emitted as plain markdown.
- Reviewer edits made with Track Changes on are emitted as new CriticMarkup changes, not hard changes, even when there were no imported suggestions.
- Comments and range comments are emitted as CriticMarkup comments/range comments.

### Stage 3: CriticMarkup Finalizer

This stage runs after editing completes.

Input:

- `reviewed.critic.md`.

Outputs:

- `final.md`: accepted markdown with all remaining change markers resolved and comments/range comments preserved.
- Optional `final-clean.md`: same accepted content with comments/range comments stripped.

Finalizer rules:

- `{++new++}` becomes `new`.
- `{--old--}` becomes empty text.
- `{~~old~>new~~}` becomes `new`.
- `{>>comment<<}` is preserved in `final.md`.
- `{==range==}{>>comment<<}` is preserved in `final.md`.
- Bare `{==range==}` highlights are stripped by default unless a separate `final-with-highlights` policy is added.
- Normal markdown is preserved with stable formatting where possible.

## Smart Matching Diff

The diff should be markdown-aware and optimized for readable review suggestions.

### Matching Strategy

Use a staged matcher:

1. Frontmatter:
   - Parse and diff frontmatter separately.
   - MVP may treat changed frontmatter keys as block-level replacements.
2. Block matching:
   - Match by markdown node type, heading path, list nesting, table cell coordinates, source order, and normalized text fingerprint.
   - Use patience or histogram diff for stable block ordering.
   - Use similarity thresholds to pair changed paragraphs rather than rendering delete-all/insert-all.
3. Inline matching:
   - Tokenize matched blocks into words, punctuation, whitespace, and markdown formatting spans.
   - Use Myers-style or diff-match-patch-style inline diff to produce small insert/delete/replace ranges.
   - Merge adjacent noisy ranges into human-readable suggestions.
4. Move detection:
   - If a deleted block and inserted block have high textual similarity, mark as a move candidate.
   - MVP renders moves as delete plus insert; later phases can show "moved from/to" cards.
5. Formatting-only changes:
   - MVP can render as replacement suggestions.
   - Phase 4 should represent bold/italic/link/code changes as format suggestions.

### Suggestion Quality Rules

- Prefer word-level replacements over character-level noise.
- Keep punctuation attached to nearby words when it improves readability.
- Preserve human review granularity: one logical human change should become one CriticMarkup marker whenever it can be represented within a single markdown block.
- When an edit crosses formatting boundaries, prefer one substitution marker containing markdown fragments over multiple smaller add/delete markers.
- Avoid suggestions that split markdown delimiters such as `**`, `_`, backticks, links, or image syntax. Expand the suggestion to a larger safe markdown span instead.
- Keep suggestions within a single markdown block for MVP.
- For tables, diff cell contents independently before treating whole rows as replacements.
- For lists, match items by text similarity and nesting level rather than raw line number.
- For code blocks, use line-level diff by default and avoid rich inline suggestions.

## Inline Review Markup

Use CriticMarkup-compatible syntax for markdown interchange. It is plain text, human-readable, and already maps to the review concepts needed here.

| Review item | Markdown syntax | Meaning |
| --- | --- | --- |
| Addition | `{++new text++}` | Proposed inserted text |
| Deletion | `{--old text--}` | Proposed removed text |
| Substitution | `{~~old text~>new text~~}` | Proposed replacement |
| Comment | `{>>comment text<<}` | Point comment |
| Highlight | `{==selected text==}` | Highlighted range |
| Range comment | `{==selected text==}{>>comment text<<}` | Comment anchored to selected text |

Rules:

- Generated output should use substitution syntax for simple replacements when it is clearer than adjacent deletion/addition markers.
- The accept/reject unit is one CriticMarkup change marker. Do not split one logical edit into multiple markers just because it crosses a formatting boundary.
- CriticMarkup change markers may contain markdown inline syntax inside their old/new payloads.
- The parser must parse CriticMarkup first, then parse each old/new payload as a markdown inline fragment for WYSIWYG rendering.
- Comments attached to suggestions can be serialized immediately after the suggestion marker.
- Inline comments should remain short. Long review discussion belongs in the UI during the session and should be summarized into the inline markdown comment when emitted.
- Escape literal CriticMarkup delimiters in normal content when needed.
- Do not create CriticMarkup spans across block boundaries in MVP.
- Do not put CriticMarkup markers inside unsupported markdown constructs where the parser cannot safely round-trip them.

Example:

```markdown
The system stores {~~JSON editor state~>markdown files~~}{>>Markdown is the system boundary.<<}
and renders {++review suggestions++} inside the editor.
```

Formatting boundary example:

```markdown
this {~~is **a great idea** for us.~>**great** for us~~}
```

This is one suggestion, even though it crosses normal and bold text. Accepting it yields `this **great** for us`; rejecting it yields `this is **a great idea** for us.`.

## Lexical Architecture

### Composer

Use the existing project convention if one exists. If this is greenfield, start with the playground-compatible React plugin approach because it maps directly to the requested rich text and markdown demos. Revisit `LexicalExtensionComposer` once the app has stable editor behavior and test coverage.

Initial config should include:

- `namespace`
- `theme`
- `nodes`
- Review-model-to-`EditorState` loader
- `onError`

Required packages:

- `lexical`
- `@lexical/react`
- `@lexical/rich-text`
- `@lexical/markdown`
- `@lexical/mark`
- `@lexical/selection`
- `@lexical/history`
- `@lexical/list`
- `@lexical/link`
- `@lexical/code`
- `@lexical/utils`

Optional packages:

- `@lexical/table` if table support is in scope.
- `@lexical/yjs` if real-time collaboration is in scope.
- `@lexical/html` if HTML import/export is needed.
- A markdown AST stack such as `unified`, `remark-parse`, `remark-stringify`, and related mdast utilities for file import/export.
- A text diff package or local implementation for inline diffing after block matching.

### Component Plan

- `ReviewEditor`
  - Owns CriticMarkup loading, output callbacks, user identity, and feature flags.
- `EditorShell`
  - Provides layout, toolbar, document surface, and review rail.
- `RichTextSurface`
  - Lexical content editable and core plugins.
- `BeforeAfterToCriticMarkup`
  - External preprocessor that parses `before.md` and `after.md`, computes the smart diff, and emits `review.critic.md`.
- `CriticMarkupReviewImporter`
  - Parses `review.critic.md` and builds the review model.
- `CriticMarkupReviewSerializer`
  - Emits `reviewed.critic.md` from the active review model.
- `CriticMarkupFinalizer`
  - Accepts all remaining change markers and emits `final.md` or `final-clean.md`.
- `MarkdownDiffEngine`
  - External preprocessor helper for block matching, inline token diffing, move candidates, and suggestion grouping.
- `CriticMarkupParser`
  - Reads additions, deletions, substitutions, comments, and range comments from `review.critic.md`.
- `CriticMarkupSerializer`
  - Writes comments/range comments and change markers back to `reviewed.critic.md`.
- `ViewModePlugin`
  - Switches between Rich Text, Markdown Source, and Plain Text.
- `MarkdownSourcePlugin`
  - Converts to/from markdown source mode through the review serializer/parser.
- `AnnotationPlugin`
  - Shared anchor handling for comments and highlights.
- `CommentsPlugin`
  - Comment composer, thread hydration, rail cards, resolve/reopen/delete.
- `HighlightsPlugin`
  - Highlight creation, color menu, removal.
- `TrackChangesPlugin`
  - Suggestion node registration, CriticMarkup suggestions, tracking toggle, and additional edit capture.
- `ReviewRail`
  - Unified rail for comments and suggestions.
- `ReviewToolbar`
  - Previous/next/accept/reject controls.
- `OutputAdapter`
  - Hands emitted CriticMarkup or final markdown back to the host workflow.

### Commands

Define explicit custom commands for editor features:

- `ADD_COMMENT_COMMAND`
- `ADD_HIGHLIGHT_COMMAND`
- `REMOVE_ANNOTATION_COMMAND`
- `RESOLVE_THREAD_COMMAND`
- `REOPEN_THREAD_COMMAND`
- `TOGGLE_TRACK_CHANGES_COMMAND`
- `ACCEPT_SUGGESTION_COMMAND`
- `REJECT_SUGGESTION_COMMAND`
- `ACCEPT_ALL_SUGGESTIONS_COMMAND`
- `REJECT_ALL_SUGGESTIONS_COMMAND`
- `NEXT_SUGGESTION_COMMAND`
- `PREVIOUS_SUGGESTION_COMMAND`
- `SET_VIEW_MODE_COMMAND`

Use Lexical command priorities carefully:

- High/editor priority for operations that must intercept destructive edits, such as deletion while Track Changes is enabled.
- Normal/low priority for UI state updates and navigation.
- Use custom update tags to prevent accept/reject operations from being tracked as new suggestions.

## Data Model

### Review Session

```ts
type ReviewSession = {
  id: string;
  inputCriticMarkdown: string;
  outputCriticMarkdown?: string;
  reviewModel: ReviewModel;
  rejectedChangeIds: string[];
  outputPolicy: OutputPolicy;
  createdAt: string;
  updatedAt: string;
};

type OutputPolicy =
  | 'final-with-comments'
  | 'final-clean'
  | 'review-markup';
```

### Review Model

`ReviewModel` is the in-memory bridge between CriticMarkup markdown and Lexical. It is deterministic for a given CriticMarkup input plus reviewer operations.

```ts
type ReviewModel = {
  blocks: ReviewBlock[];
  annotations: Annotation[];
  suggestions: Suggestion[];
  plainTextCache?: string;
};

type ReviewBlock = {
  id: string;
  type: string;
  beforeRange?: SourceRange;
  afterRange?: SourceRange;
  beforeFingerprint?: string;
  afterFingerprint?: string;
  children: ReviewInline[];
};

type ReviewInline =
  | {type: 'text'; value: string}
  | {type: 'markdown'; value: string}
  | {type: 'suggestion'; suggestionId: string; children: ReviewInline[]}
  | {type: 'annotation'; annotationId: string; children: ReviewInline[]};

type SourceRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
```

### Annotation

Annotations represent comments and highlights. In Lexical, the document stores annotation IDs in `MarkNode`s. In markdown output, annotations serialize as CriticMarkup comments/highlights.

```ts
type Annotation = {
  id: string;
  type: 'comment' | 'highlight';
  state: 'open' | 'resolved' | 'deleted';
  color?: string;
  quote: string;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  source: 'critic-markup' | 'reviewer-edit';
  markdownText?: string;
  thread?: CommentMessage[];
};
```

### Suggestion

Suggestions represent CriticMarkup changes and any additional tracked edits made during review. The Lexical document stores the suggestion ID in custom suggestion nodes.

```ts
type Suggestion = {
  id: string;
  groupId?: string;
  type: 'insert' | 'delete' | 'replace' | 'move' | 'format';
  source: 'critic-markup' | 'reviewer-edit';
  state: 'pending' | 'accepted' | 'rejected';
  createdBy: UserRef;
  createdAt: string;
  acceptedBy?: UserRef;
  acceptedAt?: string;
  rejectedBy?: UserRef;
  rejectedAt?: string;
  quoteBefore?: string;
  quoteAfter?: string;
  oldMarkdown?: string;
  newMarkdown?: string;
  beforeRange?: SourceRange;
  afterRange?: SourceRange;
  confidence?: number;
  formatDelta?: unknown;
};
```

### Comment Message

```ts
type CommentMessage = {
  id: string;
  body: string;
  createdBy: UserRef;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
};
```

### User Ref

```ts
type UserRef = {
  id: string;
  name: string;
  avatarUrl?: string;
};
```

## Annotation Implementation

Use `@lexical/mark` for comments and highlights.

Creation flow:

1. User selects text.
2. UI dispatches `ADD_COMMENT_COMMAND` or `ADD_HIGHLIGHT_COMMAND`.
3. Plugin creates an `Annotation` record with an ID and selected quote.
4. Plugin wraps the selected range with `$wrapSelectionInMarkNode(selection, isBackward, annotationId)`.
5. Plugin tracks `MarkNode` mutations to map annotation IDs to current node keys.
6. Review rail uses the ID-to-node-key map to scroll, select, and highlight active annotations.
7. Markdown serializer emits the annotation as CriticMarkup when the output policy preserves comments.

Deletion flow:

1. User deletes a highlight or thread.
2. Metadata state becomes `deleted`, or the record is removed depending on retention policy.
3. Plugin removes the annotation ID from all associated `MarkNode`s.
4. Empty `MarkNode`s are unwrapped.
5. Markdown serializer omits deleted annotations.

Import flow:

1. CriticMarkup parser detects `{>>comment<<}`, `{==highlight==}`, and `{==range==}{>>comment<<}`.
2. Parser creates `Annotation` records and review-model annotation ranges.
3. Lexical materializer wraps those ranges in `MarkNode`s.

Nested and overlapping annotations:

- Use Lexical's nested mark resolver pattern from the playground comments plugin.
- A single mark can contain multiple IDs.
- Metadata controls whether each ID is rendered as comment, highlight, or both.
- On markdown output, avoid emitting overlapping CriticMarkup ranges that cannot be safely parsed. If overlapping annotations exist, prefer serializing the most specific range inline and nearby point comments for the rest.

## Track Changes Implementation

### Node Strategy

Add custom inline nodes for suggestions rather than overloading `MarkNode`.

Suggested node shape:

- `SuggestionNode`
  - Inline element node.
  - Stores one `suggestionId`.
  - Stores `suggestionType` for local rendering fallback.
  - Stores or references parsed old/new markdown fragments for substitutions.
  - Serializes to Lexical JSON for in-session state, undo, and devtools; markdown remains the durable output.
  - Renders a `span` with stable data attributes:
    - `data-suggestion-id`
    - `data-suggestion-type`
  - Applies CSS classes for insertion/deletion/replacement states.

Use one suggestion ID for a CriticMarkup substitution. Use `groupId` only when a future UI intentionally groups multiple CriticMarkup markers, not as the default representation for a single replacement.

### Capturing Changes

Imported suggestions come from the CriticMarkup parser. The before/after diff engine is outside the core editor and has already produced `{++ ++}`, `{-- --}`, and `{~~ ~> ~~}` spans before the editor starts. Additional reviewer edits made while Track Changes is enabled must not rely only on browser DOM input events. Lexical documents that direct text insertion events can be unreliable across IME, spellcheck, speech input, screen readers, and extensions, so the implementation should combine command interception with Lexical node transforms and update listeners.

MVP capture rules:

- Initial CriticMarkup import:
  - Parse additions, deletions, and substitutions into pending suggestion nodes.
  - Mark all imported CriticMarkup suggestions as accepted-by-default unless rejected.
- Text insertion with collapsed selection:
  - Insert text inside an `insert` suggestion node when Track Changes is enabled.
  - Serialize it as `{++new++}`.
  - Continue appending to the same insertion suggestion while the cursor remains adjacent and the author is the same.
- Text deletion with collapsed selection:
  - Intercept backspace/delete commands.
  - Convert the affected character/word/range into a `delete` suggestion node instead of removing it.
  - Serialize it as `{--old--}`.
- Replacement:
  - For non-collapsed selection plus typed text/paste, create one replacement suggestion whenever the old and new content can be represented inside one markdown block.
  - Serialize replacements as `{~~old~>new~~}`, preserving markdown formatting inside both payloads.
  - Use grouped delete/insert suggestions only when a single substitution cannot be represented safely.
- Paste:
  - Insert pasted text/content inside an `insert` suggestion.
  - Preserve supported rich text structure where practical.
- Formatting changes:
  - MVP can apply formatting directly while tracking textual edits.
  - Phase 4 should create `format` suggestions with `formatDelta` metadata.

Guardrails:

- Accept/reject operations run with a `review-operation` update tag so they are not captured as new suggestions.
- Programmatic imports, markdown conversion, and document initialization run with an `import` update tag so they are not captured.
- Suggestions created by the current user's unaccepted insertion can be edited by that same user without creating nested suggestions.
- Editing another user's pending suggestion should create a new suggestion or require accepting/rejecting first. Product decision required.

### Accept/Reject Algorithms

Insertion:

- Accept: mark metadata accepted; serializer may keep `{++new++}` for the finalizer or unwrap to `new`.
- Reject: remove `SuggestionNode` and children; serializer emits nothing for that change.

Deletion:

- Accept: mark metadata accepted; serializer may keep `{--old--}` for the finalizer or emit nothing.
- Reject: unwrap `SuggestionNode`; serializer emits `old` as normal markdown.

Replacement:

- Accept: mark metadata accepted; serializer may keep `{~~old~>new~~}` for the finalizer or emit `new`.
- Reject: serializer emits `old` as normal markdown.

All suggestions:

- Compute pending suggestions in document order.
- Batch inside a single `editor.update`.
- Process deepest/nested nodes first to avoid invalidating parent references.
- Use one undo history entry for the batch.
- Update metadata after document mutation succeeds.

Editor CriticMarkup serialization:

- The editor serializer emits `reviewed.critic.md`, not final clean markdown.
- Pending or accepted insertions may serialize as `{++new++}`.
- Rejected insertions serialize as empty text.
- Pending or accepted deletions may serialize as `{--old--}`.
- Rejected deletions serialize as `old`.
- Pending or accepted replacements may serialize as `{~~old~>new~~}`.
- Rejected replacements serialize as `old`.
- Reviewer edits made with Track Changes off serialize as normal markdown.
- The finalizer accepts all remaining change markers after editor output.

## Persistence And API

The host system owns transaction storage. The editor contract is CriticMarkup in, CriticMarkup out. The preprocessor and finalizer can run inside the host system, an API service, or a shared package.

Minimum API shape:

- `POST /critic-markup/from-before-after`
  - Request: `{beforeMarkdown, afterMarkdown, options}`
  - Response: `{criticMarkdown, warnings}`
- `POST /review-sessions`
  - Request: `{criticMarkdown, options}`
  - Response: `{sessionId, suggestions, annotations, initialEditorState?}`
- `PATCH /review-sessions/:id`
  - Request: `{reviewerOperations}`
  - Response: `{suggestions, annotations}`
- `POST /review-sessions/:id/export`
  - Request: `{policy: 'review-markup' | 'final-with-comments' | 'final-clean'}`
  - Response: `{markdown}`
- `POST /critic-markup/finalize`
  - Request: `{criticMarkdown, policy: 'final-with-comments' | 'final-clean'}`
  - Response: `{markdown, warnings}`

Optional audit output:

- Rejected change IDs.
- Reviewer-created change IDs.
- Comment resolution states.
- Diff confidence scores.
- Warnings for unsupported markdown constructs.

Concurrency:

- Include a session version or ETag in mutation requests.
- Reject stale review operations or replay them against the current review model.
- If Yjs collaboration is used, comments and suggestions should each have their own shared maps/arrays, but final output remains a markdown serialization.

## Styling

Use restrained, work-focused styling.

- Comments:
  - Inline background: pale yellow.
  - Active inline background: stronger yellow.
  - Comment card border: neutral with active accent.
- Highlights:
  - User-selected color with accessible text contrast.
  - Low opacity so underlying text remains readable.
- Insertions:
  - Green text or underline plus light green background.
- Deletions:
  - Red strikethrough plus light red background.
- Replacement:
  - Grouped card in rail; inline shows red deletion near green insertion.
- Review rail:
  - Compact cards, 8px radius or less.
  - Author avatar/initials, name, time, actions.
  - No decorative gradients or marketing-style cards.

Accessibility:

- All toolbar buttons have labels and tooltips.
- Inline marks expose semantic labels via `aria-label` or related side panel controls.
- Review rail is keyboard navigable.
- `Esc` closes composers/popovers.
- `Tab` order moves from editor to active review controls predictably.
- Color is never the only signal for suggestion type.

## Implementation Phases

### Phase 1: CriticMarkup Pipeline Core

Deliverables:

- `before.md` and `after.md` to `review.critic.md` preprocessor.
- Markdown AST parsing with source positions.
- Smart block and inline matching.
- CriticMarkup parser/serializer for additions, deletions, substitutions, comments, and range comments.
- CriticMarkup finalizer that emits `final-with-comments` and `final-clean`.
- Golden-file tests for representative markdown fixtures.

Acceptance criteria:

- The same `before.md`/`after.md` pair always produces the same `review.critic.md`.
- Finalizer accepts all remaining additions/deletions/substitutions.
- Finalizer preserves point comments and range comments in `final-with-comments`.
- Finalizer strips comments and range comments in `final-clean`.
- Markdown constructs unsupported by MVP produce explicit warnings.

### Phase 2: Lexical Review Editor

Deliverables:

- Rich Text editor with toolbar.
- Materialization of CriticMarkup changes into Lexical suggestion nodes.
- Markdown shortcut support.
- Markdown Source view through the review serializer.
- Plain Text read-only view.
- Suggestion rail cards.
- Accept/reject current.
- Previous/next suggestion navigation.

Acceptance criteria:

- User can review CriticMarkup suggestions in Rich Text mode.
- Rejecting a suggestion rewrites editor output so the finalizer cannot apply the rejected change.
- User can view `reviewed.critic.md` source and copy plain text.
- Undo/redo works for review operations.

### Phase 3: Inline Comments, Highlights, And Phone UX

Deliverables:

- `AnnotationPlugin`.
- CriticMarkup comment/range-comment parser and serializer.
- Comment composer and review rail/bottom sheet.
- Highlight creation/removal/color changes.
- Active annotation selection and scroll synchronization.
- Resolve/reopen/delete comment threads.
- Phone-first document layout, sticky review controls, and bottom-sheet cards.

Acceptance criteria:

- User can comment on selected text, reply, resolve, reopen, and delete.
- Comments serialize to inline CriticMarkup in markdown output when comments are preserved.
- User can highlight selected text and remove highlight.
- Core review flow works one-handed on phone viewport sizes.
- Active suggestion/comment is never hidden behind the keyboard or bottom sheet.

### Phase 4: Track Changes And Markdown Hardening

Deliverables:

- Track Changes toggle for additional reviewer edits.
- Insertion/deletion/replacement suggestions for reviewer edits.
- Accept all/reject all.
- Safer markdown source behavior with pending suggestions.
- Optional diff-based markdown source edits converted into suggestions.
- Export modes: `review-markup`, `final-with-comments`, `final-clean`.
- Tests for annotations/suggestions across markdown transitions.

Acceptance criteria:

- Text typed while tracking is on becomes an insertion suggestion.
- Deleted text becomes a deletion suggestion instead of disappearing.
- Replacing selected text creates a grouped replacement.
- Accept all/reject all produce correct final markdown.
- Users cannot accidentally lose review metadata by switching modes.
- Markdown export output matches selected export policy.
- Pending suggestions are clearly represented or intentionally excluded.

### Phase 5: Collaboration And Audit Trail

Deliverables:

- Optional Yjs-backed comments and suggestions.
- Stable user identities and presence-aware authorship.
- Audit log for accept/reject/resolve actions.

Acceptance criteria:

- Multiple users can add comments and suggestions without overwriting each other.
- Review metadata remains consistent after remote updates.
- Audit events are persisted with actor and timestamp.

## Testing Plan

Unit tests:

- Markdown parser/serializer round trips for supported nodes.
- CriticMarkup parser/serializer for additions, deletions, substitutions, point comments, range comments, and optional bare highlights.
- CriticMarkup substitutions containing markdown inline formatting, such as bold/link/code spans inside old/new payloads.
- CriticMarkup finalizer acceptance rules for additions, deletions, and substitutions.
- CriticMarkup finalizer preservation rules for comments and range comments.
- Smart diff block matching for paragraphs, headings, lists, tables, and code blocks.
- Inline diff token grouping for readable suggestions.
- Smart diff grouping where one logical edit crosses formatting boundaries.
- Annotation mark add/remove behavior.
- Nested/overlapping mark handling.
- Suggestion node serialization/deserialization.
- Accept/reject algorithms for insert/delete/replace.
- Export modes with pending suggestions.
- Editor CriticMarkup serialization after rejected changes.

Integration tests:

- Convert `before.md`/`after.md` to `review.critic.md`.
- Import `review.critic.md` and render CriticMarkup suggestions.
- Render and accept/reject a single substitution that crosses normal and bold text.
- Rich Text to Markdown Source and back.
- Add comment, reply, resolve, reopen, delete.
- Add highlight, change color, remove.
- Track insertion, deletion, replacement.
- Accept/reject current suggestion.
- Accept all/reject all suggestions.
- Undo/redo around review operations.

End-to-end tests:

- Keyboard-only comment workflow.
- Mouse selection comment workflow.
- Phone selection, comment, accept, reject, and next/previous workflow.
- Paste while Track Changes is enabled.
- Markdown source lockout with pending suggestions.
- Mobile review bottom sheet behavior.
- Long document with many annotations and suggestions.
- Golden-file transaction: `before.md` plus `after.md` emits expected `review.critic.md`.
- Golden-file finalizer: `reviewed.critic.md` emits expected `final.md`.

Performance tests:

- 50-page document load and first input latency.
- 1,000 annotations/suggestions rail rendering.
- Accept all/reject all on 500 suggestions.
- Markdown diff and serialization on large documents.
- Phone viewport interaction latency with bottom sheet open.

## Risks And Mitigations

- Diff quality can produce noisy or misleading suggestions.
  - Mitigation: use staged block/inline matching, confidence scores, golden fixtures, and fallback to block-level replacement when confidence is low.
- CriticMarkup has practical limits around multi-block ranges and complex markdown nesting.
  - Mitigation: keep generated inline review marks within one markdown block and warn when content cannot be safely marked inline.
- Raw markdown source can invalidate review anchors.
  - Mitigation: make markdown editable only when safe in MVP; add explicit warning for destructive source edits.
- Track changes is complex across IME, paste, spellcheck, and browser extensions.
  - Mitigation: combine command interception with Lexical transforms/update listeners; add fixture-heavy tests.
- Overlapping comments, highlights, and suggestions can produce nested inline markup.
  - Mitigation: keep comments/highlights in `MarkNode`, suggestions in dedicated nodes, and test nested cases.
- Accept/reject operations can corrupt selection or history.
  - Mitigation: batch operations with update tags and explicit history behavior.
- Long documents can make review rail alignment expensive.
  - Mitigation: virtualize the rail and recompute anchor positions only for visible cards.
- Phone keyboard and bottom-sheet interactions can hide active text.
  - Mitigation: design phone as a primary layout, reserve safe-area space, and test real viewport/keyboard behavior.
- Collaboration can create conflicting suggestion edits.
  - Mitigation: defer full collaboration until base single-user behavior is stable, or use Yjs from the start if collaboration is a launch requirement.

## Open Decisions

- Which markdown dialect and extensions are in scope for `before.md` and `after.md`?
- Should output default to `final-with-comments` or `final-clean`?
- What exact inline convention should be used for multi-reply comments if markdown is the only persistence layer?
- Should Markdown Source be editable when comments exist but no suggestions exist?
- Are format changes required in the first track changes release?
- Should users be allowed to edit another user's pending suggestion?
- Is collaboration required at launch?
- Does the host system need an audit JSON artifact in addition to the final markdown output?

## Definition Of Done

- All phase-specific acceptance criteria for the targeted release are met.
- `before.md` plus `after.md` produces deterministic `review.critic.md`.
- The editor imports CriticMarkup, renders rich review UI, and emits valid `reviewed.critic.md`.
- Rejected changes are resolved in `reviewed.critic.md` before finalization.
- Final markdown output accepts all remaining change markers and preserves comments/range comments.
- Inline comments and range comments round-trip through CriticMarkup.
- Review UI works with mouse, keyboard, and touch, with phone workflows tested as first-class.
- Markdown/plain text export policies are documented in-product or API docs.
- Unit and E2E tests cover comments, highlights, track changes, and mode switching.
- Accessibility review passes for toolbar controls, comment composers, rail navigation, and accept/reject flows.
