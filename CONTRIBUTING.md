# Contributing to Emir Code

Bug reports, suggestions, documentation fixes and pull requests are welcome.

---

## Development setup

Requirements:
- Node.js 20 or newer (CI uses Node.js 22) and npm
- Ollama running locally (`http://localhost:11434`) with a model, for example `ollama pull qwen2.5-coder:7b`

```bash
git clone https://github.com/daristanapeyvan/emircode.git
cd emircode
npm install
npm run dev          # Vite + Electron with hot reload
```

Checks before a pull request:
```bash
npx tsc --noEmit
npm test             # all regression suites; none of them needs Ollama
```

Optional:
```bash
npm run test:agent      # only the agent suites
npm run check:library   # reads the live ollama.com pages to catch markup changes (needs internet)
node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts qwen2.5-coder:7b web-new   # benchmark against a real model
```

The benchmark scenarios are `web-new`, `web-followup`, `repair-corrupted`, `js-bugfix`, `python-cli`, `json-config`, `nav-links`, `six-products`, `wizard-site`, `wizard-mini` and `wizard-script` (see the top of `scripts/agent-e2e.ts`). On a computer without a GPU each scenario takes several minutes.

Packages:
```bash
npm run build:installer   # Windows: release/Emir Code Setup X.Y.Z.exe and the portable exe
npm run build:linux       # Linux: deb, rpm, AppImage, tar.gz
```

---

## Where things are

| Area | Files |
| :--- | :--- |
| Agent loop, approvals, guards | `src/lib/agent/AgentEngine.ts` |
| System prompt and tool schema | `src/lib/agent/AgentProtocol.ts` |
| Parsing and repairing model actions | `src/lib/agent/ToolDispatcher.ts` |
| File checks per language | `src/lib/agent/FileSanity.ts` |
| Web page acceptance checks | `src/lib/agent/TaskContract.ts`, `src/lib/agent/TaskValidator.ts` |
| Context length, sampling, model profile | `src/lib/ollama/ModelRuntime.ts`, `src/lib/ollama/OllamaClient.ts` |
| Chat and web search | `src/stores/chatStore.ts`, `src/lib/web/` |
| File access, tokens, commands, web requests | `electron/main.ts`, `electron/preload.ts` |
| Packaging hooks | `scripts/afterPack.js` (Windows icon, Linux launcher), `scripts/postbuild.js` |
| Creation wizards | `src/lib/wizard/`, `src/components/agent/wizard/`, `src/stores/siteWizardStore.ts`, `src/stores/toolWizardStore.ts` |
| Design themes | `src/lib/design/` |
| Model library | `src/lib/ollama/library.ts`, `src/stores/modelLibraryStore.ts`, `src/components/models/DiscoverTab.tsx`, the `models:*` handlers in `electron/main.ts` |
| Projects in the sidebar | `src/lib/utils/projects.ts`, `src/components/layout/HistorySidebar.tsx`, `src/components/agent/NewProjectDialog.tsx` |
| Shared interface parts | `src/components/common/`, `src/lib/ui/dialogs.ts` (confirm and notice dialogs), `src/lib/ui/overlays.ts` |
| Interface texts | `src/lib/localization/translations/en.ts`, `tr.ts` |
| Tests | `test_*.ts` in the repository root, `scripts/verify_functionality.js`, `scripts/agent-e2e.ts`, fixtures in `test_fixtures/` |
| Release pipeline | `.github/workflows/release.yml`, `scripts/linux-smoke-test.sh` |

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how these parts work together.

---

## Conventions

- **Types.** Avoid `any` where a type or interface can be written.
- **File and command access.** The preload script and IPC must not expose direct write functions. Agent changes go through `requestMutationToken` and `applyApprovedMutation`; a new command has to pass the allowlist in `workspace:runApprovedCommand`. See [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).
- **Stable system prompt.** The agent's system prompt must stay identical between the steps of a task, because Ollama's cache depends on it. Put per-step information into tool results.
- **Tests with fixes.** A fix for an agent failure seen with a real model comes with a regression check in `test_agent_reliability.ts` or `test_agent_engine.ts`. File checks must not report errors on valid code.
- **Texts in both languages.** Every visible text goes through the translation files; add or change it in both `en.ts` and `tr.ts`. Examples, sample data and defaults must work for users in any country: money and dates from the locale, no country-specific assumptions.
- **Interface.** Use the shared components in `src/components/common/` (`Modal`, `Button`, `IconButton`, `Toggle`, `Select`, `Tabs`, `StartIcon`) and the settings rows in `src/components/settings/SettingsRow.tsx`. Ask for confirmation with `confirmDialog` and show messages with `noticeDialog` from `src/lib/ui/dialogs.ts`, not with `window.confirm` or `window.alert`. Use the existing Tailwind color classes (zinc, red, amber, emerald, blue); colors are CSS variables in `src/index.css`, so the same classes work in the dark and the light theme. Do not write hex colors in components, and check new screens in both themes.

---

## Pull requests

1. Fork the repository and create a branch, for example `fix/cart-total-rounding`.
2. Make sure `npx tsc --noEmit` and `npm test` pass.
3. Write commit messages that say what changed, for example `fix(agent): refuse edits that delete a function still in use`.
4. Open the pull request with what changed, why, and how you tested it.

Releases are made by pushing a `vX.Y.Z` tag; the release workflow builds the Windows and Linux packages and publishes the GitHub release.
