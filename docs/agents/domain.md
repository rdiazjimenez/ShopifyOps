# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — ShopifyOps whole-project glossary.
- **`features/<name>/CONTEXT.md`** — feature-scoped glossary for the area being worked on.
- **`docs/adr/`** — system-wide architectural decisions.
- **`features/<name>/docs/adr/`** — feature-scoped decisions.

If any of these files don't exist, **proceed silently**.

## File structure

Multi-context repo layout:

```
/
├── CONTEXT.md                          ← whole-project glossary
├── docs/adr/                           ← system-wide decisions
└── features/
    └── bulk-update/
        ├── CONTEXT.md                  ← feature glossary
        ├── PRD.md
        └── docs/adr/                   ← feature-scoped decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
