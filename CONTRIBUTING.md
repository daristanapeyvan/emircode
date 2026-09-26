# 🤝 Contributing to Emir Code

Thank you for your interest in contributing to **Emir Code**! Bug reports, feature suggestions, documentation improvements and pull requests are welcome.

---

## 🛠️ Development Setup

1. **Prerequisites**:
   - Node.js 20+ (CI uses Node 22) and npm
   - Ollama running locally (`http://localhost:11434`)
   - Recommended model: `ollama pull qwen2.5-coder:7b`

2. **Clone and install**:
   ```bash
   git clone https://github.com/daristanapeyvan/emircode.git
   cd emircode
   npm install
   ```

3. **Start the development environment** (Vite + Electron with hot reload):
   ```bash
   npm run dev
   ```

4. **Type-check and run the regression suites**:
   ```bash
   npx tsc --noEmit
   npm test              # functional, agent reliability, agent engine, architecture, web access, design theme, wizard and model library suites
   npm run check:library # optional: the live ollama.com pages still parse (needs internet)
   npm run test:agent    # only the agent suites (unit checks + scripted-model engine tests)
   ```

5. **Benchmark the agent against a real model** (optional, takes minutes per scenario on CPU):
   ```bash
   node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts qwen2.5-coder:7b web-new
   ```
   Scenarios: `web-new`, `web-followup`, `repair-corrupted`, `js-bugfix`, `python-cli`, `json-config`, `nav-links`, `six-products`, `wizard-site`, `wizard-mini`, `wizard-script` (see the header of `scripts/agent-e2e.ts`).

6. **Build packages**:
   ```bash
   npm run build:installer   # Windows: release/Emir Code Setup X.Y.Z.exe + portable exe
   npm run build:linux       # Linux: deb, rpm, AppImage, tar.gz
   ```

---

## 🗂️ Where Things Live

| Area | Files |
| :--- | :--- |
| Agent loop, approvals, guards | `src/lib/agent/AgentEngine.ts` |
| System prompt and tool JSON schema | `src/lib/agent/AgentProtocol.ts` |
| Parsing / repairing model actions | `src/lib/agent/ToolDispatcher.ts` |
| Per-language file checks | `src/lib/agent/FileSanity.ts` |
| Web page acceptance checks | `src/lib/agent/TaskContract.ts`, `src/lib/agent/TaskValidator.ts` |
| Context window, sampling, model profile | `src/lib/ollama/ModelRuntime.ts`, `src/lib/ollama/OllamaClient.ts` |
| Chat, web search fallback | `src/stores/chatStore.ts`, `src/lib/web/` |
| File jail, tokens, commands, web bridge | `electron/main.ts`, `electron/preload.ts` |
| Packaging hooks | `scripts/afterPack.js` (Windows icon, Linux launcher), `scripts/postbuild.js` |
| Creation wizards | `src/lib/wizard/` (requests, catalogs, script safety module), `src/components/agent/wizard/`, `src/stores/siteWizardStore.ts`, `src/stores/toolWizardStore.ts` |
| Design themes | `src/lib/design/` |
| Model library (Models → Discover) | `src/lib/ollama/library.ts` (parsing, sizes, quantizations, categories), `src/stores/modelLibraryStore.ts`, `src/components/models/DiscoverTab.tsx`, `models:*` handlers in `electron/main.ts` |
| Agent tests | `test_agent_reliability.ts` (unit), `test_agent_engine.ts` (scripted model), `scripts/agent-e2e.ts` (real model), `scripts/electron-api-mock.ts` |
| Theme, wizard and library tests | `test_design_theme.ts`, `test_site_wizard.ts`, `test_tool_wizard.ts`, `test_model_library.ts` (fixtures in `test_fixtures/ollama`) |
| Release pipeline | `.github/workflows/release.yml`, `scripts/linux-smoke-test.sh` |

---

## 📐 Coding Conventions

- **Strict typing**: no `any` where a concrete type or interface can be written.
- **Security first**: never expose direct filesystem write APIs in the preload script or IPC. All disk modifications go through `requestMutationToken` and `applyApprovedMutation`; new commands must pass the allowlist in `workspace:runApprovedCommand`.
- **Prompt stability**: the agent's system prompt must stay byte-identical between steps (Ollama's KV cache depends on it). Put per-step information into tool results, not into the system prompt.
- **Tests with fixes**: a fix for an agent failure seen with a real model should come with a regression check in `test_agent_reliability.ts`. File checks must not report errors on valid code.
- **Bilingual UI strings**: whenever you add or change user-facing text, update both `src/lib/localization/translations/tr.ts` and `en.ts`.
- **Component design**: favor small, reusable Tailwind CSS components.

---

## 🔀 Pull Request Process

1. Fork the repository and create a descriptive branch:
   ```bash
   git checkout -b feature/amazing-improvement
   ```
2. Make sure `npx tsc --noEmit` and `npm test` pass.
3. Commit with clear, descriptive messages:
   ```bash
   git commit -m "feat(agent): add interactive inline option chips"
   ```
4. Push your branch and open a Pull Request describing the change, the motivation and how you tested it.

Releases are created by pushing a `vX.Y.Z` tag; the release workflow builds the Windows and Linux packages, launches the Linux packages in a virtual display and publishes the GitHub release.
