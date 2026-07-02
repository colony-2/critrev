# review2

Framework-agnostic CriticMarkup review pipeline core.

The current implementation focuses on the durable text pipeline:

1. Convert `before.md` and `after.md` into `review.critic.md`.
2. Parse/edit/render CriticMarkup as review suggestions.
3. Finalize CriticMarkup into accepted markdown with optional comments preserved.

## Commands

```sh
npm install
PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright install chromium
npm test
npm run test:e2e
npm run typecheck
npm run build:demo
npm run dev
```

The demo runs at:

```txt
http://localhost:5173/
```

## Core API

```ts
import {
  beforeAfterToCriticMarkup,
  finalizeCriticMarkup,
  listCriticMarkupChanges,
  parseCriticMarkup,
  resolveCriticMarkupChange,
  serializeCriticMarkup,
} from 'review2';
```

## Current Scope

- CriticMarkup parse/serialize/finalize.
- Individual CriticMarkup change extraction and accept/reject resolution.
- Deterministic first-pass `before.md` plus `after.md` to CriticMarkup conversion.
- Vanilla TypeScript demo page showing the pipeline, including raw editor input, editable review surface, raw editor output, and finalizer output.
- Rendered editor edits become additional CriticMarkup suggestions instead of hard changes.
- Comment demo flow for seeded point/range comments plus selection comments from context menu or long touch.
- Playwright e2e coverage for the demo page in desktop and phone viewports.

The before/after conversion is intentionally an initial dependency-free pass. It preserves one logical formatted-boundary replacement as one CriticMarkup substitution, but it is not yet the full markdown AST matcher described in the spec.
