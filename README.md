# Paraco plugins

Eight independently installable local applications. Each directory contains its own manifest, server, browser code and assets; nothing imports from a sibling package or downloads browser dependencies at runtime.

| Application | Everyday use | Host access |
| --- | --- | --- |
| System Vitals + Port Scout | CPU chart, memory, load, uptime, searchable listening ports | `system` (Linux) |
| Prompt Regression Lab | Saved prompt cases, model selection, deterministic checks, run comparisons | `storage`, configured `ai` |
| Cron Time Machine | Actual next-run previews, timezone comparisons, saved schedules | `storage`, task authoring |
| JSON / YAML Workbench | Format, convert, inspect, copy, import and export data | None |
| AI Memory Curator | Edit, tag, archive, review duplicates, export and optionally summarize memories | `storage`; `ai` for suggestions |
| Local Uptime Sentry | Scheduled HTTP checks, observed availability, history and failure inbox | Task authoring and exact network destinations |
| GitHub Pulse | Public repository stats, recent open issues/PRs and releases | Task authoring and `api.github.com:443` |
| Scientific Lab Notebook | Structured experiments, project filters, Markdown and JSON exports | `storage` |

## Marketplace installation

Each app is published as a separate asset in the [v0.1.0 release](https://github.com/dioko-ai/paraco-plugins/releases/tag/v0.1.0). Use a current Paraco catalog:

```sh
paraco marketplace install scientific-lab-notebook --version 0.1.0 --output ./scientific-lab-notebook
paraco run ./scientific-lab-notebook
```

The individual app README includes standalone setup. Installation verifies the catalog digest and does not start apps or grant task/AI access.

## Start all eight from source

Use the sibling `paraco` checkout containing the `system` capability. Build it with `cargo build --locked` and install its pinned tools with `npm ci` if needed. Then, from this folder:

```sh
./start.sh
```

Open the dashboard URL printed by Paraco (default port 3000). Each application also has its own origin, such as `http://scientific-lab-notebook.localhost:3000/`. Set `PARACO_PORT` to change the port; `PARACO_REPO` or `PARACO_BIN` to use another checkout/binary. This starts a foreground process; Ctrl+C stops it. It does not register a background service.

`server.json` grants task authoring to the three scheduling apps. GitHub Pulse can fetch public repositories immediately. Before adding an uptime monitor, edit its `taskNetwork` list to include the exact service host and port, then restart. For example:

```json
{"path":"local-uptime-sentry","taskAuthoring":true,"taskNetwork":["127.0.0.1:8080","status.example.com:443"]}
```

For AI, add an `aiConfig` path to the Prompt Regression Lab and/or AI Memory Curator entries. Follow the sibling host's `docs/ai-routing.md` to grant providers/models to each actual installation ID. Credentials belong in the host configuration outside plugin directories. Memory curation works without AI; prompt runs require a configured provider.

To run a storage-only or stateless app on its own, use `paraco run ./scientific-lab-notebook`. Task apps need `serve` with a task-authoring grant. System Vitals requires the new `system` manifest capability and Linux procfs. Installing a new package records its requested capabilities; adding capabilities to an existing installation requires the host's explicit approval workflow.

## Data and behavior

- The workbench keeps its editor in this browser's local storage, capped at 1 MiB. Clear removes it. Data stays local; no network parsing service is used. YAML 2.8.1 is bundled with its license, rejects duplicate keys, and bounds alias expansion.
- Notebooks, memories, prompt suites and cron bookmarks use Paraco versioned records. Concurrent stale writes fail instead of silently overwriting. Export edits before reloading a conflict. Collections are limited to 200 items and approximately 58 KB per save; prompt history retains the last 10 runs. These are focused text workspaces, not large-file stores.
- Memory Curator can open a host-granted shared dataset alias. It stores the documented `memory-curator:v1` record containing `{memories:[...]}`; other explicitly granted apps can read it. Dataset access errors never fall back to private storage. Sharing is configured by the owner in `platform.json` as described in the host's `docs/platform-evolution.md`.
- Uptime checks run while Paraco and the computer are on. The dashboard labels availability as **observed checks**, excluding skipped/cancelled checks. A check succeeds only for the specified HTTP status. Redirect responses are checked as-is; redirects are not followed. Failed checks create Paraco inbox notifications. No email/SMS delivery is implied.
- GitHub Pulse reads public data without a token. It keeps a bounded snapshot in retained task output, displays its timestamp and last check status, and keeps the latest successful snapshot when a subsequent check fails. It shows the 15 most recently updated open issues/PRs and the latest 5 releases. Four active repositories are allowed; hourly checks are the default. Manual refreshes and other apps share GitHub's [unauthenticated rate limit](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- System Vitals reads aggregate counters and listening/bound sockets. It does not expose environment variables, process command lines, arbitrary filesystem access, process termination, or active port scans. CPU samples live only in the open page. Metrics describe the host running Paraco.
- Prompt assertions check literal containment, trimmed exact text, or valid JSON. Results are deterministic checks, not a general judgment of model quality. Provider/model routing is restricted by host grants. Stopping a suite lets the current request finish and skips remaining cases.

## Verification

With the sibling Paraco checkout's development dependencies available:

```sh
npm run check
npm run test:runtime
```

The contract tests mock AI and GitHub responses. The runtime suite launches all eight packages with a real workerd host, tests scheduler/HTTP monitoring, storage/restart/conflicts, telemetry and browser workflows at desktop/mobile sizes. Its HTTP monitor fixture is local and temporary; it does not contact a live AI provider or GitHub. Screenshots under `screenshots/` use isolated test data, never seed installed applications.

Marketplace releases contain the allowlisted files produced by `python3 scripts/package.py --version 0.1.0 --output dist`. Rebuilding from the tagged source produces identical package bytes. Retain an installation’s canonical source path when upgrading to preserve its identity. Back up Paraco state before moving installations.

## Release verification

Build packages with `python3 scripts/package.py --version 0.1.0 --output dist`. `dist/SHA256SUMS` records every package digest. Source commit and digest are pinned independently in the Paraco catalog. Packages include Apache-2.0 licensing and the YAML parser’s MIT notice.
