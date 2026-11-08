# Adapter UI preview

Preview the production adapter page components against an in-memory transport fixture. No platform credentials, running Bot, AI provider, or remote Console checkout is required. Requests are never forwarded to a real Host or platform.

From the repository root, after `pnpm install`:

```bash
pnpm preview:ui
# or: pnpm exec vite --config scripts/adapter-preview/vite.config.mts
```

Open `http://localhost:4174` (defaults to `/ui` — the live `@zhin.js/client/ui` component & style workbench with viewport simulator, size/tone switchers, and box-model outline debugger). The top navigation bar also includes ICQQ login verification (`/icqq`), Telegram/Discord account management (`/telegram`, `/discord`), Sandbox conversations (`/sandbox`), and Bilibili comment review (`/bilibili`). Use the theme button to inspect light/dark variants, and the viewport controls to test narrow screens and sticky table columns.

Account mutations, login completion, draft editing, and Sandbox messages only change this page's synthetic data. Reloading resets it. The displayed QR image is deliberately nonfunctional.

## Design conventions

- White/black/gray surfaces and typography. Saturated color is reserved for primary actions and semantic feedback.
- Accounts are the primary workspace; platform tools/status are secondary. Configuration uses native expandable disclosures rather than always-visible technical details.
- Login tasks are visible before account actions. Expired tasks explain the next step and cannot be submitted.
- Styles are scoped to adapter-owned surfaces and shipped with their browser entries. They do not restyle the surrounding Console.
- Visible keyboard focus, reduced-motion support, theme overrides, responsive layout, and labelled form controls are required.

## Regression checks

```bash
pnpm --filter @zhin.js/client build
```

```bash
pnpm vitest run packages/console/client/client/adapter-console/AdapterConsolePage.test.ts plugins/adapters/bilibili/tests plugins/adapters/sandbox/tests
```
