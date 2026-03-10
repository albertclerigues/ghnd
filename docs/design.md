

# Project Title: GitHub Notification Dashboard (GHD)

## Authors
- Albert Clerigues

## Overview

GHD is a macOS-native desktop application that serves as a unified GitHub notification center, pinboard, and activity tracker. Built on Electrobun — a lightweight Bun-powered desktop framework — it presents three views in a tabbed interface: a notification feed enriched with LLM-generated summaries, a user-curated board of pinned issues and PRs, and a chronological activity log. Crucially, the app exposes its full functionality through both its graphical interface and a companion CLI tool, enabling AI agents such as Claude Code to programmatically query, triage, and organize GitHub work alongside the human user. All mutations — whether initiated by the GUI, the CLI, or the background poller — are reflected in real time across every surface.

## Background and Motivation

GitHub's built-in notification system is a flat, ephemeral list. It tells you that something happened on a thread, but collapses the history of what happened since you last looked. Power users who work across many repositories develop ad-hoc rituals: opening dozens of tabs, mentally grouping related items, and triaging in bulk — all without durable state. The situation is worse for developers who pair with AI coding agents, because those agents have no interface to the human's notification workflow: they cannot mark items as reviewed, flag something for later, or even ask what the user has been working on.

GHD addresses both problems. For the human, it provides a persistent, structured dashboard that tracks the full event timeline per notification — not just the latest trigger — with AI-generated one-line summaries to make scanning fast. For the AI agent, it provides a CLI that speaks the same language as the GUI, backed by a shared local database. This dual-interface design makes notification triage a collaborative act between human and machine, operating over a single source of truth.

## Goals and Non-Goals

### Goals

- Deliver a native-feeling macOS desktop application using Electrobun, with system tray presence and keyboard-driven navigation.
- Present GitHub notifications as enriched timelines, grouped by their originating thread and annotated with LLM summaries of individual events.
- Allow users to pin issues, PRs, and discussions into named groups for persistent quick access.
- Display a tabular activity feed of the authenticated user's recent GitHub actions.
- Expose all read and write operations through a CLI tool that AI agents can invoke, with changes propagated to the GUI in real time.
- Store all state locally in SQLite so that the application is fast, queryable offline, and inspectable.

### Non-Goals

- **GitHub write-back for all operations.** GHD marks threads as read on GitHub when the user opens them in the browser, but it does not comment, merge, close, or otherwise mutate GitHub resources.
- **Multi-user or team features.** The app serves a single authenticated user.
- **Windows or Linux support in the initial release.** Electrobun is cross-platform, but design decisions — titlebar style, tray behavior, keyboard conventions — target macOS first.
- **Full offline mode.** The app requires periodic network access to poll GitHub and call the summarization API. The local database provides resilience against transient connectivity loss but is not designed as a true offline-first sync engine.
- **Custom notification filtering rules.** The initial release shows all notifications for the authenticated user; advanced filter expressions are deferred.

## Detailed Design

### System Architecture

The application follows a three-process architecture natural to Electrobun. A **Bun main process** runs the application logic: it owns the SQLite database, polls the GitHub REST API on a timer, generates LLM summaries, and exposes an RPC surface to the browser context. A **WebView process** (WebKit on macOS) renders the user interface and communicates with the Bun process through Electrobun's typed RPC channel. A **CLI process** — a standalone Bun script — communicates with the running main process over a Unix domain socket using a JSON-RPC protocol.

The Bun main process is the single source of truth. Every mutation — whether a user clicking "mark as done" in the GUI, an agent running `ghd done <id>` from the terminal, or the poller discovering new events — follows the same path: write to SQLite, then push a lightweight invalidation message to the WebView so it re-fetches only the affected section. This ensures all surfaces are always consistent without polling or diffing in the browser.

The application is configured to remain running when the window is closed, living in the system tray. This is essential because the CLI must be able to reach the IPC server at any time, and the background poller must continue to collect notifications regardless of whether the user is looking at the window.

### Components

**GitHub Client.** A thin, SDK-free wrapper around `fetch` that authenticates with a personal access token and exposes methods for listing notifications, marking threads as read, fetching issue and PR timelines, and listing user events. It handles pagination and respects rate-limit headers by backing off when the remaining quota is low.

**Notification Poller.** A timer-driven loop that calls the GitHub Notifications API at a configurable interval (default 30 seconds), using the `since` parameter to request only threads updated after the last successful sync. For each new or updated thread, it resolves the subject URL to obtain the browser-facing link, fetches the issue or PR timeline to build the event subtree, and persists everything to SQLite. Events with comment bodies longer than a threshold are passed to the summarizer before storage.

**Activity Poller.** A second timer that fetches the authenticated user's public event stream from the GitHub Events API. It maps GitHub event types (PushEvent, IssueCommentEvent, PullRequestEvent, etc.) into a normalized action vocabulary (committed, commented, opened, closed, merged, reviewed) and stores them with their target title, repository, and timestamp.

**LLM Summarizer.** An interface with a single method — `summarize(text) → string` — implemented against the Anthropic API using Claude Haiku in programmatic mode. The prompt instructs the model to compress a GitHub comment into twelve words or fewer, capturing intent rather than detail. The summarizer is injected as a dependency into the poller, making it straightforward to replace with a deterministic stub in tests or a local model in the future.

**Database Layer.** A module that initializes a SQLite database (via Bun's built-in `bun:sqlite`), applies versioned migrations, and exports a typed query interface. All queries are encapsulated behind a `GHDDatabase` interface with methods like `upsertNotification`, `listPinnedGrouped`, and `rawQuery`. The interface — not the implementation — is what the rest of the codebase depends on, which is what makes it possible to instantiate a real in-memory database in tests without mocking.

**IPC Server.** A Unix domain socket listener (at a well-known path `/tmp/ghd.sock`) that accepts JSON-RPC requests, dispatches them to the same handler functions the GUI uses, and writes the result back. Each connection is short-lived: the CLI opens a socket, sends one request, reads one response, and closes. Because the handlers mutate the database and then push an invalidation to the WebView, any CLI command is immediately visible in the GUI.

**CLI Tool.** A standalone Bun script intended to be symlinked into the user's PATH as `ghd`. It parses subcommands (`list`, `done`, `pin`, `unpin`, `pin-move`, `groups`, `activity`, `query`), serializes them as JSON-RPC calls, sends them to the Unix socket, and prints the result as a formatted table or confirmation message. The `query` subcommand accepts raw read-only SQL, which is particularly powerful for AI agents that need ad-hoc access to the local data.

**WebView UI.** A single BrowserWindow with a custom `hiddenInset` titlebar and three tab-switched content sections. The browser-side code uses Electrobun's `Electroview.defineRPC` to establish typed communication with the Bun process. It registers a message handler for `stateUpdated` events; when one arrives it re-fetches and re-renders only the affected tab. The UI is implemented in vanilla TypeScript and HTML — no framework — because the rendering surface is simple enough (lists, trees, tables, cards) that a reactive framework would add more indirection than it removes.

### Data Models

The local database contains four primary tables.

**notifications** stores one row per GitHub notification thread. It records the thread ID, repository, subject type and title, the resolved browser URL, the notification reason, read/unread status, GitHub timestamps, and a local `dismissed_at` timestamp for items the user has marked as done.

**notification_events** stores the event subtree for each notification. Each row captures an event type (comment, review, review request, merge, close, label, assignment), the actor, a truncated raw body, the LLM-generated summary, a deep-link URL, and a timestamp. A composite unique constraint on notification ID and event ID prevents duplicates across polls.

**pinned** stores user-pinned items with their subject metadata, a group name, and an ordering integer within that group. Pinning can originate from the notifications tab (linking back via a foreign key) or from the CLI with an arbitrary URL.

**activity** stores the user's event stream in a normalized form: event ID, type, repository, action verb, target title and URL, and timestamp. It is append-only and pruned periodically to keep only the last N days.

A small **sync_meta** key-value table tracks the last successful poll timestamp for each poller, enabling incremental fetches.

### APIs

**Bun ↔ Browser RPC.** A shared TypeScript type defines the contract. The Bun side exposes request handlers — `getNotifications`, `getPinned`, `getActivity`, `markDone`, `pinItem`, `unpinItem`, `openInBrowser` — and the browser side exposes a single message handler — `stateUpdated` — which receives a scope tag indicating which section changed. Electrobun generates fully typed caller and handler stubs from this shared type, so a mismatch between the two sides is a compile-time error.

**CLI ↔ App IPC.** A typed protocol defines every legal method name, its parameter shape, and its return type. The IPC server dispatches incoming requests through a handler map whose keys are constrained to this protocol type. The CLI constructs requests using the same types. Because both sides share the protocol definition, adding a new command requires updating one type, one handler, and one CLI subcommand — with the compiler verifying consistency across all three.

**GitHub REST API.** The client consumes three endpoint families: Notifications (`GET /notifications`, `PATCH /notifications/threads/{id}`), Timeline Events (`GET /repos/{owner}/{repo}/issues/{number}/timeline`), and User Events (`GET /users/{username}/events`). All calls use the `2022-11-28` API version header and classic personal access token authentication.

### User Interface

The window uses a hidden inset titlebar with a custom draggable header region containing three tab buttons: Notifications, Pinned, and Activity. Only one tab's content section is visible at a time.

**Notifications tab.** Each notification renders as a block with the subject title, type icon, and repository name on the first line, followed by an indented tree of events using box-drawing characters (├── and └──). Each event line shows the event type, the actor, a relative timestamp, and — when available — the LLM summary prefixed with a sparkle emoji. The list is sorted by most recent activity. Navigation is entirely keyboard-driven: arrow keys move focus between notifications and their sub-items, Enter opens the focused item in the default browser (and marks the parent thread as read on GitHub), and Space marks the notification as done. When the user presses the right arrow to enter a notification's sub-items, a floating preview box appears in the top-right corner showing the parent notification's title and metadata, providing context while scrolling through events.

**Pinned tab.** A card layout (one or two columns depending on window width) with cards grouped under named section headers. Each card shows the item type, title, and repository. Cards can be unpinned from the GUI; reordering and group management are available through both the GUI and the CLI.

**Activity tab.** A full-width table with columns for action (styled as a colored badge), target, repository, and timestamp. The table is sorted by most recent first and paginates or virtualizes for long histories.

## Implementation Strategy

The implementation proceeds in a sequence that builds value incrementally, with each phase producing a testable, demonstrable artifact.

The first phase establishes the project skeleton: Electrobun scaffolding, TypeScript configuration with full strictness, Biome linting, the directory structure, and a minimal window that loads a static HTML page. This validates the toolchain end to end.

The second phase builds the data layer: the SQLite schema, migration runner, typed query interface, and the GitHub client with notification polling. At the end of this phase the app polls GitHub and stores notifications locally, verifiable through the database directly.

The third phase connects the data to the UI: Electrobun RPC wiring, the tab shell, and the notifications renderer with the event subtree. The pinned and activity tabs follow immediately after, as they are simpler projections of the same data layer.

The fourth phase adds the LLM summarizer, integrating it into the polling loop so that new comment events are annotated with one-line summaries before storage.

The fifth phase implements keyboard navigation — the arrow-key focus model, Enter to open, Space to dismiss, and the floating preview box for sub-item browsing.

The sixth phase builds the IPC server and CLI tool. Because the handler functions already exist (they back the RPC layer), this phase is primarily about the socket transport and the CLI argument parser.

The seventh phase polishes: tray icon, application menu, error handling for network failures and rate limits, graceful degradation when the LLM is unavailable, and configuration (token, poll intervals, database path).

## Risks and Mitigations

**GitHub API rate limits.** The REST API allows 5,000 requests per hour for authenticated users. Aggressive polling of timelines for many active notifications could approach this limit. Mitigation: use conditional requests with `If-Modified-Since` / `304 Not Modified`, poll incrementally using the `since` parameter, and implement exponential backoff when the rate limit header indicates low remaining quota. The poller interval is configurable so users with heavy notification volumes can tune it.

**LLM latency and cost.** Summarizing every comment adds latency to the poll cycle and incurs API costs. Mitigation: summarization is performed asynchronously and does not block the notification from appearing in the UI — the summary is backfilled once ready. A length threshold skips summarization for short comments that are already scannable. The summarizer interface allows swapping in a local model or disabling summaries entirely via configuration.

**Electrobun maturity.** Electrobun is a young framework. APIs may change, and edge cases in IPC or WebView behavior may surface. Mitigation: the application's core logic (database, GitHub client, poller, CLI) has zero coupling to Electrobun — it is plain Bun TypeScript. Electrobun is only touched in the window setup, RPC wiring, tray, and menu modules. If the framework introduces breaking changes, the blast radius is contained to those thin integration layers.

**Unix socket reliability.** If the app crashes without cleaning up the socket file, the CLI will fail to connect on the next launch. Mitigation: the IPC server unconditionally unlinks the socket path before binding, and the CLI provides a clear error message when the socket is unreachable, suggesting the user check whether the app is running.

## Testing Strategy

The project adopts a strict anti-mock testing philosophy. External dependencies are not simulated with mock libraries; instead, they are replaced with real-but-isolated implementations of the same interface.

**Type safety as the first line of defense.** TypeScript is configured at maximum strictness, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Domain entities use branded types for identifiers so the compiler rejects accidental misuse (e.g., passing a `PinId` where a `ThreadId` is expected). The RPC and IPC protocols are defined as shared types that both sides of each boundary import, making contract drift a compile-time error. Discriminated unions model event types with exhaustiveness checking, ensuring every renderer and formatter handles every case.

**Unit tests** cover pure logic with no I/O: event formatting, relative time rendering, timeline parsing from fixture data, prompt construction for the summarizer, and branded type construction. These are fast, deterministic, and form the bulk of the test count.

**Integration tests** exercise real infrastructure at the edges. The database layer is tested against real SQLite instances created in memory — the same engine as production, instantiated in under a millisecond. Tests verify full CRUD lifecycles, migration correctness, and query semantics against seeded data. The IPC layer is tested by starting a real Unix socket server on a test-scoped path, connecting a real client, and verifying round-trip request/response behavior including error cases. The notification poller is tested against a fixture-based GitHub client — a class that implements the full `GitHubClient` interface but returns recorded API responses from JSON files instead of making network calls. This is not a mock; it is a complete alternate implementation, type-checked with `satisfies` to guarantee interface conformance.

**The LLM summarizer** is the one component where real calls are impractical in tests. Rather than mocking the Anthropic SDK, the summarizer is defined as an interface. A deterministic contract stub implements this interface by deriving a predictable output from the input text. Tests verify that consumers handle the summary correctly — presence, absence, length constraints — without depending on model output.

**Electrobun's own RPC and rendering layer is not tested by this project.** Application logic is extracted into plain functions and tested directly; the thin glue that wires those functions to Electrobun handlers is trusted to the framework and verified manually during development.

Linting is enforced by Biome with rules targeting unused imports, implicit `any`, non-null assertions, and cognitive complexity. Git hooks run type checking, linting, and unit tests on every commit; the full suite (including integration tests) runs on push.

## Dependencies

| Dependency        | Role                          | Notes                                                                                         |
| :---------------- | :---------------------------- | :-------------------------------------------------------------------------------------------- |
| **Electrobun**    | Desktop application framework | Provides BrowserWindow, Tray, ApplicationMenu, typed RPC, and the build/bundle pipeline       |
| **Bun**           | Runtime and bundler           | Ships with Electrobun; provides the TypeScript runtime, built-in SQLite, and Unix socket APIs |
| **`bun:sqlite`**  | Local database                | Built into Bun; no external package required                                                  |
| **Anthropic SDK** | LLM summarization             | Used to call Claude Haiku in programmatic mode for one-line comment summaries                 |
| **Biome**         | Linting and formatting        | Single-binary replacement for ESLint + Prettier; dev dependency only                          |
| **Lefthook**      | Git hooks                     | Single-binary hook runner; dev dependency only                                                |

The project deliberately avoids a UI framework, a GitHub SDK (the API surface needed is small enough for a thin fetch wrapper), a test mock library, and a DI container.

## Phasing

### Phase 1 — Foundation
Project scaffolding, TypeScript strict configuration, Biome setup, Electrobun hello-world window, and the SQLite schema with migration runner. **Milestone:** the app launches, displays a static page, and creates the database on disk.

### Phase 2 — Data Pipeline
GitHub REST client, notification poller with timeline enrichment, activity poller, and the full database query interface. Integration tests for the database layer and poller using fixture data. **Milestone:** notifications and activity are polled, stored, and queryable from tests.

### Phase 3 — GUI Core
Electrobun RPC wiring, tab shell, notifications renderer with event tree, pinned card layout, activity table, and the real-time push mechanism from Bun to browser. **Milestone:** the app displays live notifications, pinned items, and activity in a tabbed interface.

### Phase 4 — LLM Integration
Anthropic summarizer implementation, integration into the poll loop, summary display in the event tree, and the contract stub for tests. **Milestone:** new comment events appear with sparkle-prefixed one-line summaries.

### Phase 5 — Keyboard Navigation
Arrow-key focus model for the notifications list, sub-item navigation with the floating preview box, Enter to open in browser, Space to mark as done. **Milestone:** the notifications tab is fully operable without a mouse.

### Phase 6 — CLI & IPC
Unix domain socket server, JSON-RPC dispatch, CLI tool with all subcommands, and integration tests for the full CLI-to-GUI round trip. **Milestone:** `ghd list`, `ghd done`, `ghd pin`, and `ghd query` work against the running app, and changes appear in the GUI immediately.

### Phase 7 — Polish
System tray with template icon, application menu with standard edit shortcuts, error handling for rate limits and network failures, LLM fallback when the API is unavailable, user configuration (token, intervals, database path), and a README with setup instructions. **Milestone:** the app is ready for daily-driver use.

## Conclusion

GHD turns GitHub notifications from a disposable list into a persistent, structured workspace — one that both humans and AI agents can operate. By combining Electrobun's lightweight native shell with Bun's fast runtime and built-in SQLite, the application stays small, fast, and dependency-light. The dual-interface design — GUI and CLI backed by a shared database and real-time push — makes it natural for tools like Claude Code to participate in notification triage without any special integration layer. The testing strategy prioritizes real implementations over mocks, the type system enforces contracts at compile time, and the phased delivery plan ensures each increment is independently valuable and testable.

