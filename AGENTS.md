# Repository Guidelines

`TERAX.md` is the living architecture doc and the source of truth. Read it before making changes. If anything here or in `docs/` conflicts with it, `TERAX.md` wins.

## Project Overview

Terax is an open-source AI-native terminal emulator: Tauri 2 + Rust backend (`portable-pty`), React 19 + TypeScript frontend, libghostty-vt WASM terminal model (WebGPU default renderer, WebGL fallback), BYOK AI via Vercel AI SDK v6. Ultra-lightweight is the product: roughly a 7-8 MB bundle with per-tab memory budgets. Bundle id `app.crynta.terax`. This repo is a private downstream fork of `crynta/terax-ai` (see `FORK.md`); private patches live on `fix/default-model-and-compat-context`, never PR'd upstream.

## Architecture & Data Flow

Two-process model. Rust (`src-tauri/`) owns all OS access: PTY, filesystem, git, shell, network, secrets, workspace authorization. The webview never touches the FS, processes, or shells directly.

- IPC: `invoke()` calls to about 90 commands registered in `src-tauri/src/lib.rs` (`generate_handler!`). Namespaces: `pty_*`, `fs_*`, `git_*`, `shell_*`, `workspace_*`/`wsl_*`, `lsp_*`, `net` (`ai_http_stream`/`ai_http_cancel`/`ai_http_ack`/`lm_ping`), `secrets_*`, `ai_session_*`, `agent_*`, `control_*`, `window_*`. Implementation lives in `src-tauri/src/modules/<area>/`.
- PTY output does not use per-terminal channels: one multiplexed pull stream per window over the custom `terax-pty` URI scheme (`src-tauri/src/modules/pty/`: `hub.rs` scheduler, `wire.rs` framing, `protocol.rs` endpoints). Frontend `PtyOutputHub` owns the poll loop and demultiplexes to receivers with byte-credit backpressure.
- AI HTTP goes through the Rust proxy (`ai_http_stream`) with SSRF guard, keeping provider calls off the webview; frontend wrapper `src/modules/ai/lib/proxyFetch.ts` uses `Channel` + ack.
- Frontend: single-window React app. Tabs are a tagged union (`terminal` | `editor` | `preview` | `markdown` | `ai-diff` | `git-diff` | `git-history` | `git-commit-file`) and are never unmounted on switch, only hidden (`invisible pointer-events-none`), so PTYs keep streaming.
- Terminal stack: `src/modules/terminal/ghostty/` consumes `@terax/ghostty-core` (`packages/ghostty-core`, the adapted Ghostty VT parser; adapted revision pinned in `packages/ghostty-core/adapted/UPSTREAM.md`). Each leaf owns one persistent WASM model; all WebGPU panes of a window draw into one shared canvas.
- Functional core, imperative shell: new logic goes in pure, dependency-light functions; Tauri commands and React components stay thin.

Adding a Tauri command: `#[tauri::command]` in `src-tauri/src/modules/<area>/` -> register in `src-tauri/src/lib.rs` -> plugin permission in `src-tauri/capabilities/default.json` if a plugin is used -> typed wrapper in `src/modules/<area>/lib/` -> anything touching fs/net/shell must pass the guards (`src/modules/ai/lib/security.ts` deny-list, workspace authorization, SSRF guard, AI tool approval).

State management patterns:

- zustand stores: `src/modules/agents/store/agentStore.ts`, `src/modules/ai/store/chatStore.ts` (and siblings).
- Coordinator hooks: `src/modules/tabs/lib/useTabs.ts` (tab/pane tree, source of truth), `src/modules/spaces/lib/` (`useSpaces`).
- Persistence: `LazyStore` from `tauri-plugin-store` (`src/modules/settings/store.ts`, `terax-spaces.json`) plus `store.onChange` and Tauri events for cross-window sync.
- Rust DI: `.manage(State)` in `lib.rs` (about 13 states, e.g. `PtyState`, `WorkspaceRegistry`), commands take `State<'_, T>`.

## Key Directories

| Path | Purpose |
|---|---|
| `src/modules/<area>/` | 22 self-contained feature modules (terminal, editor, explorer, ai, agents, source-control, git-history, tabs, spaces, settings, theme, lsp, workspace, ...). Each exports a thin barrel via `index.ts` and keeps hooks in `lib/`. |
| `src/app/` | `App.tsx` coordinator, global hooks, budget-lock tests. |
| `src/components/ui/`, `src/components/ai-elements/` | Generated shadcn/ui and Vercel AI Elements. Never hand-edit; regenerate via `pnpm dlx shadcn add`. |
| `src/lib/` | Pure utilities and shared hooks. |
| `src/settings/` | Second window entry (`settings.html` -> `src/settings/main.tsx`). |
| `src/bench/` | Perf lab drivers, only compiled under `__TERAX_BENCH__`. |
| `src-tauri/src/modules/` | Rust backend: `pty/`, `fs/`, `git/`, `shell/`, `net/`, `lsp/`, `secrets.rs`, `workspace.rs`, `control.rs`, `ai_sessions.rs`, `agent.rs`, `vibrancy.rs`, ... |
| `src-tauri/crates/` | `terax-cli` (sidecar binary for external control) and `terax-control-protocol` (shared serde types). |
| `src-tauri/tests/` | Rust integration tests with `GitRepoFixture`/`FsFixture`. |
| `packages/ghostty-core/` | `@terax/ghostty-core`: official + adapted (+ scalar) ghostty-vt WASM and TS wrappers. |
| `scripts/` | Profiling, smoke, and visual harnesses (many macOS-only). |
| `docs/` | Contributor guides; `docs/README.md` is the index. |

## Development Commands

```bash
pnpm install
pnpm tauri dev        # dev app: builds terax-cli sidecar + vite dev server (port 1420)
pnpm tauri build      # production bundle
pnpm dev              # vite only
pnpm build:cli        # build terax-cli sidecar into src-tauri/binaries/

# Frontend checks (all must pass before claiming done)
pnpm lint             # biome lint ./src
pnpm check-types      # tsc --noEmit
pnpm test             # vitest run
pnpm format           # biome format --write

# Rust checks (run inside src-tauri/)
cargo clippy --all-targets --locked -- -D warnings
cargo nextest run --locked   # fallback: cargo test --locked
cargo fmt

# Budgets and analysis
pnpm size             # size-limit (blocking in CI)
pnpm knip             # dead-code check (advisory)
pnpm check:dist       # verify dist/ startup graph
pnpm analyze:eager    # eager import graph report

# Perf and smoke harnesses (mostly macOS-only, see scripts/)
pnpm bench:ghostty    # vitest bench on AdaptedGhostty
pnpm soak:ghostty     # long-run resource soak (own vitest config)
pnpm profile:ghostty  # wasm allocation/parse benchmarks vs baseline
python3 scripts/pty-smoke/run.py          # real PTY transport scenarios
python3 scripts/renderer-profile/run.py   # isolated WKWebView renderer lab
python3 scripts/app-lab/run.py            # whole-app resource benchmarks
```

Git workflow: branches from main with prefixes `feat/ | fix/ | chore/ | docs/ | perf/ | security/`, kebab-case. PR title is the squash commit, Conventional Commits style (scopes like `terminal`, `pty`, `ai`, `editor`). One logical change per PR; no drive-by formatting.

## Code Conventions & Common Patterns

- pnpm only, never npm/npx/yarn. Node >= 22.
- Imports: always `@/...`, never relative across modules.
- Biome formatting: double quotes, line width 80, 2-space indent, semicolons, trailing commas. Generated dirs (`src/components/ui`, `src/components/ai-elements`) are exempt.
- Comments: default to none; the code explains itself. If needed, 1-2 lines on why, never what, no AI filler.
- No em-dashes anywhere (code, comments, commits, docs). No emojis anywhere.
- Cross-platform paths: normalize separators with `.split(/[\\/]/)`, never `.split("/")`. Canonical frontend path form is forward-slash; `homeDir()` returns backslashes on Windows, convert at the boundary.
- Terminal input: send `\r` (CR) for Enter, not `\n`; PowerShell requires CR.
- Rust: use the `dirs` crate for home/cache dirs, never raw `$HOME`/`%USERPROFILE%`. Platform-specific logic goes in `#[cfg(unix)]`/`#[cfg(windows)]` arms (see `pty/shell_init.rs`).
- Secrets: OS keychain only via `keyring` (service `terax-ai`); never persist keys to disk, settings store, or localStorage.
- AI tools: `read_file`, `list_directory`, `fs_search`, `fs_grep` auto-execute; mutating tools (`write_file`, `run_command`, ...) set `needsApproval: true`. The secret-path deny-list in `src/modules/ai/lib/security.ts` applies on both read and write paths and is never bypassed.
- React: `App.tsx` stays a coordinator; new features go inside `modules/<area>/`. Keep `AiComposerProvider` mounted unconditionally at the root (conditional wrap remounts the tree and re-spawns PTYs).
- Performance bar: every change is judged on RAM cost, IPC round-trips, re-renders, and dependency weight. Nothing animates forever at display rate; no `will-change`, `backdrop-filter`, or blur outside the allowlist locked by `src/styles/compositingBudget.test.ts`.
- Startup graph: neither window may preload the AI SDK, zod, Streamdown, CodeMirror, or the icon set. Enforced by `src/app/eager-budget.test.ts` and `src/app/dist-budget.test.ts`; chunk groups are configured in `vite.config.ts` (eager `react`/`radix`/`ghostty-vt` at priority 100).
- New dependencies need justification above roughly 50 KB gzip client-side or 5 MB Rust-side.

## Important Files

- `TERAX.md` - living architecture doc; read before changes.
- Entry chain: `index.html` -> `src/main.tsx` (closes orphan PTYs, seeds launch dir, shows window after paint) -> `src/app/App.tsx`. Settings window: `settings.html` -> `src/settings/main.tsx`. Rust: `src-tauri/src/main.rs` -> `terax_lib::run()` in `src-tauri/src/lib.rs`.
- `src-tauri/src/lib.rs` - command registry, managed state, `terax-pty` scheme registration.
- `src/modules/terminal/` - terminal core: `useGhosttyTerminalSession`, gpu/webgl surfaces, block mode, PTY transport client.
- `src/modules/tabs/lib/useTabs.ts` - tab/pane tree state.
- `src/modules/settings/store.ts` - preferences persistence + cross-window sync.
- `src/modules/ai/` - `lib/agent.ts` (AI SDK v6 agent shape), `config.ts` (providers), `lib/security.ts` (deny-list), `tools/tools.ts`.
- Config: `vite.config.ts` (chunk groups, aliases), `biome.json`, `tsconfig.json` (`@/*` -> `src/*`, strict), `pnpm-workspace.yaml` (catalog pins `@lezer/highlight` so parsers and themes share one Lezer instance), `src-tauri/tauri.conf.json` + `tauri.windows.conf.json`/`tauri.linux.conf.json`, `src-tauri/capabilities/default.json`, `components.json` (shadcn).
- Known gotchas are listed at the end of `TERAX.md` (React 19 strict-mode double PTY spawn in dev, Windows ConPTY lifecycle lock and Job Object, `tab.cwd` separator normalization).

## Runtime/Tooling Preferences

- Node >= 22; pnpm pinned via `packageManager` (`pnpm@11`). pnpm is the only package manager.
- Rust stable; `cargo nextest` preferred for tests, plain `cargo test` accepted.
- Platforms: macOS, Linux, Windows. Windows frontend build target is `chrome120`. Several profiling harnesses (`renderer-profile`, `ipc-profile`, `app-lab`, `pty-smoke`) are macOS-only.
- `pnpm-workspace.yaml` sets `minimumReleaseAge` of 3 days (supply-chain protection); fresh releases are rejected.
- The `@lezer/highlight` catalog pin must stay single-instance: duplicate copies silently break token styling.

## Testing & QA

- Frontend: vitest 4, node environment only (no jsdom, no @testing-library). Tests are colocated with sources (about 370 `*.test.ts` files, e.g. `src/modules/terminal/ghostty/*.test.ts`). Style: `describe`/`it` + `expect`, `vi.mock` for `invoke`, dependency injection via explicit environment objects.
- Rust: inline unit tests as `#[cfg(test)] mod tests { use super::*; }` at file end (56 sites), plus integration tests in `src-tauri/tests/` (`git_operations.rs`, `shell_background.rs`, `fs_search.rs`, `ghostty_artifacts.rs`, fixtures in `common/mod.rs`). Dev-deps include `proptest`.
- Contract (`docs/contributing/testing.md`): tests lock invariants, not line coverage. A change to a core subsystem (terminal/shell spawn, workspace authorization including deny paths, git command layer, fs mutations, IPC and AI tool surface, high-impact pure logic) needs a test that locks the invariant, including boundaries and rejection paths. UI rendering, themes, and things the type system already guarantees do not need tests.
- Platform-specific tests must be gated `#[cfg(windows)]`/`#[cfg(unix)]`.
- Budget-lock tests are load-bearing: `src/app/eager-budget.test.ts`, `src/app/dist-budget.test.ts`, `src/styles/motionBudget.test.ts`, `src/styles/compositingBudget.test.ts`. Update allowlists only with a reason per entry.
- CI (`.github/workflows/ci.yml`): frontend job (audit, lint, check-types, test, build, size-limit blocking, knip advisory), terminal-platforms (vitest on `src/modules/terminal` for Windows + macOS), rust (check, clippy `-D warnings`, nextest, machete), rust-platforms, coverage (`cargo llvm-cov nextest`).
- Release diagnostics in a built app: `localStorage.setItem("terax:terminal-diagnostics", "1")` then reload; `window.__teraxTerm()` for counters.
