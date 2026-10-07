# Contributing to Emir Code

Bug reports, suggestions, documentation fixes and pull requests are welcome.

---

## Development setup

Requirements:
- Node.js 20 or newer (CI uses Node.js 22) and npm
- Ollama running locally (`http://localhost:11434`) with a model, for example `ollama pull qwen2.5-coder:7b`, or an API key of a cloud provider (Ollama Cloud, Anthropic, OpenAI, Gemini or Mistral) entered in Settings › Cloud models, or an OpenAI-compatible server such as LM Studio

```bash
git clone https://github.com/daristanapeyvan/emircode.git
cd emircode
npm install
npm run dev          # Vite + Electron with hot reload
```

Checks before a pull request:
```bash
npx tsc --noEmit
npm test             # all regression suites; none of them needs Ollama or a cloud account
```

Optional:
```bash
npm run test:agent      # only the agent suites
npm run test:sandbox    # the isolated environment of commands, tried for real on this system
npm run check:library   # reads the live ollama.com pages to catch markup changes (needs internet)
node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts qwen2.5-coder:7b web-new   # benchmark against a real model
```

The benchmark scenarios are `web-new`, `web-followup`, `repair-corrupted`, `js-bugfix`, `python-cli`, `json-config`, `nav-links`, `six-products`, `wizard-site`, `wizard-mini`, `wizard-script`, `center-header` and `center-header-followup` (see the top of `scripts/agent-e2e.ts`). On a computer without a GPU each scenario takes several minutes.

### Cloud models: live checks

`npm test` checks every provider without a network (fake clients, and a local HTTP server standing in for an OpenAI-compatible server). The live checks need real keys, cost a few cents and are run by hand; keys come from the environment only and are never written to disk:

```bash
# Every provider with a key: model list, a short answer, one agent step with the answer schema,
# the same with thinking and effort, the native tool mode (Claude, GPT), and a wrong key masked.
ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GEMINI_API_KEY=… MISTRAL_API_KEY=… OLLAMA_API_KEY=… \
  node ./scripts/run-ts-test.mjs scripts/cloud-smoke.ts [--only=anthropic,openai]
# An OpenAI-compatible server too
EMIR_COMPAT_URL=http://localhost:1234/v1 EMIR_COMPAT_NAME="LM Studio" node ./scripts/run-ts-test.mjs scripts/cloud-smoke.ts --only=compat

# The agent benchmark on a cloud model: results get tokens and the estimated cost
ANTHROPIC_API_KEY=… node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts anthropic::claude-sonnet-5-5 web-new,js-bugfix,python-cli,json-config
# The same with the experimental native tool mode, for the comparison in docs/PLAN_ACIK_NOKTALAR.md
ANTHROPIC_API_KEY=… node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts anthropic::claude-sonnet-5-5 web-new,js-bugfix,python-cli,json-config --native-tools
```

`EMIR_SMOKE_MODEL_<PROVIDER>` picks the model of the smoke test (for example `EMIR_SMOKE_MODEL_ANTHROPIC=claude-haiku-4-5`). The repository owner can run the smoke test in GitHub Actions with the repository's secrets (**Actions › Cloud smoke test › Run workflow**); it never runs for pushes, pull requests or forks. Before a release that changes the cloud code, also go through the manual checklist in [docs/KULLANIM.md](./docs/KULLANIM.md#elle-doğrulama-listesi).

Packages:
```bash
npm run build:installer   # Windows: release/Emir Code Setup X.Y.Z.exe and the portable exe
npm run build:linux       # Linux: deb, rpm, AppImage, tar.gz
```

---

## Where things are

| Area | Files |
| :--- | :--- |
| Agent loop, approvals, guards | `src/lib/agent/AgentEngine.ts`, one handler per tool in `src/lib/agent/run/`, helpers in `src/lib/agent/engineHelpers.ts` |
| Texts of the agent engine and check results | `src/lib/agent/engineText.ts`, `src/lib/agent/checkTexts.ts` |
| System prompt and tool schema | `src/lib/agent/AgentProtocol.ts` |
| Parsing and repairing model actions | `src/lib/agent/ToolDispatcher.ts` |
| File checks per language | `src/lib/agent/FileSanity.ts` |
| Web page acceptance checks | `src/lib/agent/TaskContract.ts`, `src/lib/agent/TaskValidator.ts` |
| Context length, sampling, model profile | `src/lib/ollama/ModelRuntime.ts`, `src/lib/ollama/OllamaClient.ts` |
| Model references, the gateway every model call goes through, cloud error texts | `src/lib/providers/` (`modelRef.ts`, `ModelGateway.ts`, `errorText.ts`) |
| Cloud providers: keys, requests, streams | `electron/cloud/` (`keyStore.ts`, `endpoints.ts`, `anthropic.ts`, `openai.ts` (also Mistral and compatible servers), `gemini.ts`, `ollamaCloud.ts`, `nativeTools.ts`, `schema.ts`, `errors.ts`, `index.ts`), `src/components/settings/CloudSettings.tsx` and `src/components/settings/cloud/`, the cloud part of `src/stores/modelStore.ts` |
| Prices, the models in the selector, provider readiness | `src/lib/providers/pricing.ts`, `src/lib/providers/visibleModels.ts`, `src/lib/providers/cloudStatus.ts` |
| Limits of the agent by model tier | `src/lib/agent/agentLimits.ts`, `modelTier` in `src/lib/ollama/ModelRuntime.ts` |
| Live checks and the bridge for scripts | `scripts/cloud-smoke.ts`, `scripts/cloud-bridge.ts`, `.github/workflows/cloud-smoke.yml` |
| Chat and web search | `src/stores/chatStore.ts`, `src/lib/web/` |
| File access, tokens, running commands | `electron/main.ts`, `electron/preload.ts` |
| Which commands may run | `electron/commandPolicy.ts` |
| Isolated environment of commands | `electron/sandbox.ts`, `native/windows/` (the launcher: AppContainer, separate account, write protection; the Node guard), `scripts/build-sandbox.cjs` |
| Web requests, read-only git, texts of the main process | `electron/web.ts`, `electron/git.ts`, `electron/i18n.ts` |
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
- **File and command access.** The preload script and IPC must not expose direct write functions. Agent changes go through `requestMutationToken` and `applyApprovedMutation`; a new command has to pass the rules in `electron/commandPolicy.ts`, which the main process checks again in `workspace:runApprovedCommand`. See [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).
- **Stable system prompt.** The agent's system prompt must stay identical between the steps of a task, because Ollama's cache (and the prompt caches of Claude and OpenAI) depend on it. Put per-step information into tool results.
- **Model calls.** The chat and the agent call models only through `modelGateway.chatStream`, never through a provider directly, so local and cloud models behave the same.
- **Cloud keys.** API keys stay in the main process: no IPC channel may return one, they are never written to `emir_code_data.json` or a log, and the agent's commands do not get them. Error texts pass through `classifyCloudError`, which masks every known key and anything key-shaped. A built-in provider uses one fixed address (no address from the environment or the interface); an OpenAI-compatible server's address lives in the main process and its key is bound to it. Every client refuses redirects. Adapters are tested with fake clients, without network access (`test_cloud_providers.ts`, `test_cloud_features.ts`).
- **Prices.** The built-in price table (`src/lib/providers/pricing.ts`) holds only list prices known when the version is made, with `PRICES_AS_OF`; the interface calls every cost an estimate. Do not guess the price of a new model: leave it unknown so the user sets it.
- **Tests with fixes.** A fix for an agent failure seen with a real model comes with a regression check in `test_agent_reliability.ts` or `test_agent_engine.ts`. File checks must not report errors on valid code.
- **Texts in both languages.** Every visible text goes through the translation files; add or change it in both `en.ts` and `tr.ts`. This includes the main process (`mt()`) and the agent engine (`et()`). Texts for the model stay English. Examples, sample data and defaults must work for users in any country: money and dates from the locale, no country-specific assumptions.
- **Interface.** Use the shared components in `src/components/common/` (`Modal`, `Button`, `IconButton`, `Toggle`, `Select`, `Tabs`, `StartIcon`) and the settings rows in `src/components/settings/SettingsRow.tsx`. Ask for confirmation with `confirmDialog` and show messages with `noticeDialog` from `src/lib/ui/dialogs.ts`, not with `window.confirm` or `window.alert`. Use the existing Tailwind color classes (zinc, red, amber, emerald, blue); colors are CSS variables in `src/index.css`, so the same classes work in the dark and the light theme. Do not write hex colors in components, and check new screens in both themes.

---

## Pull requests

1. Fork the repository and create a branch, for example `fix/cart-total-rounding`.
2. Make sure `npx tsc --noEmit` and `npm test` pass.
3. Write commit messages that say what changed, for example `fix(agent): refuse edits that delete a function still in use`.
4. Open the pull request with what changed, why, and how you tested it.

Releases are made by pushing a `vX.Y.Z` tag; the release workflow builds the Windows and Linux packages and publishes the GitHub release.
