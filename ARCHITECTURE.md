# Emir Code Architecture

Emir Code is an Electron app (React 19, TypeScript, Zustand, Tailwind CSS) that talks to a local Ollama server. This document describes how the parts fit together and where the code lives. Security details are in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).

---

## 1. Processes

| Process | Responsibilities | Code |
| --- | --- | --- |
| Main (Node.js) | Project folder access (path checks, reads, writes, undo copies), the command runner, read-only git, web search and page fetching, the model library requests to ollama.com, app data storage, Ollama start-up, Linux desktop integration | `electron/main.ts` |
| Preload | Exposes the typed `window.electronAPI` bridge; the window runs with `contextIsolation: true` and `nodeIntegration: false` | `electron/preload.ts` |
| Renderer | The interface, the stores, the agent engine and all requests to Ollama (`/api/chat`, `/api/show`, `/api/pull`, …) | `src/` |

The agent engine runs in the renderer. It never touches the disk itself: every read, write, command and web request goes through an IPC call to the main process, which checks it again.

---

## 2. How an agent task runs

1. **Start.** `agentStore.startGoal` calls `AgentEngine.runGoal` with the request, the model, the security profile and the previous task of the session (request, outcome, changed files).
2. **Probing.** The engine asks the main process for `git status` and the file list, and reads the model's size, native context length and capabilities from Ollama's `/api/show` (`ModelRuntime.ts`). If Git is not available, the git tools are left out; for the Autonomous profile `ask_user` is left out; without web access the web tools are left out. Models up to 4.5B parameters get a shorter tool list without `search_code` and `delete_file`.
3. **Planning.** The request becomes a checklist only when the user wrote an explicit list or joined steps with sequencing words (section 4). For web pages, `TaskCompiler` creates acceptance checks (section 5). For a new web page, a design theme is chosen (section 7).
4. **Tool loop** (at most 35 steps and 50 tool calls, within the task time limit from Settings › General, 30 minutes by default; time spent waiting for the user is not counted):
   - The engine sends the static system prompt and the append-only history to `/api/chat`, with the JSON Schema of the enabled tools as Ollama `format`.
   - The model answers with one action: `{"thought": …, "action": …, …fields}`. The tools are `list_dir`, `read_file`, `search_code`, `write_file`, `edit_file`, `replace_lines`, `delete_file`, `run_command`, `git_status`, `git_diff`, `web_search`, `fetch_url`, `ask_user` and `finish`.
   - Reads go through the main process. Writes and edits are checked (section 6), shown as a diff and, depending on the profile, approved by the user or applied directly. The main process then writes the file.
   - Every result goes back to the model with a one-line state (section 3).
5. **Finish.** `finish` is accepted when every acceptance check passes and no written file has open check errors. Otherwise the model gets `[CANNOT FINISH YET]` with the problems, at most twice. A change task that has not changed any file gets `[CHECK]` once. After `finish` the design theme and the page repairs are applied, and the task ends with a completion card (green) or an incomplete card (amber) that lists what could not be verified.

The task stops early after 3 consecutive errors, 3 repeated actions in a row, 10 steps without progress, the step or tool-call limit, or the time limit. When it stops for repetition or lack of progress but every acceptance check already passes (or, for scripts, the model's own program ran successfully after its last change), it ends as completed with a note instead (`tryGracefulCompletion`).

The run state is tracked by `AgentStateMachine`, which only allows these transitions:

| From | To |
| --- | --- |
| PENDING | PLANNING, BLOCKED |
| PLANNING | EXECUTING, BLOCKED, FAILED |
| EXECUTING | VALIDATING, RETRYING, BLOCKED |
| VALIDATING | COMPLETED, RETRYING, FAILED |
| RETRYING | EXECUTING, FAILED, BLOCKED |
| COMPLETED | PLANNING, DONE |

BLOCKED, FAILED and DONE are final.

---

## 3. Prompt, context and state

- **Static system prompt.** The system prompt (`AgentProtocol.ts`) is the same in every step of a task, and the history is only appended to. Ollama can then reuse its cache for the unchanged beginning of the prompt instead of reading everything again at each step.
- **State line.** Per-step information is appended to the newest tool result as one line, for example `[STATE] step 6/35 · changed files: index.html · checklist 1/3 done (next: #2) · acceptance checks 5/7 passing`. It can also name the last user decision, unavailable commands and missing paths.
- **Context length.** Every request to Ollama sends an explicit `num_ctx`. It comes from Settings › Agent › Context length (Auto: chosen for this computer's hardware and capped by the model's native context). Chats use the same value unless a chat has its own override, so Ollama does not reload the model when you switch modes.
- **Compaction.** The engine estimates the prompt size before each request. When the prompt would not leave room for the answer, older tool results and actions are shortened (the newest exchanges stay complete). If that is not enough, the oldest exchanges are dropped and replaced by a short note that names the changed files. A file body removed from history is replaced by a line such as `[read_file "src/App.tsx": 870 lines — content removed from history to save space; read it again if you need it]`.
- **Small projects.** In projects with up to 6 files the current file contents are part of the first task message, up to a quarter of the context window.
- **Output length.** When Ollama stops because the output limit was reached (`done_reason: "length"`), the step is retried with a larger `num_predict` (up to 60 % of the context window), then the model is asked for a smaller step.
- **Untrusted data.** File contents, search results, git output and web results are wrapped in markers such as `<<<UNTRUSTED_PROJECT_DATA: path>>>` and `<<<WEB_RESULT_UNTRUSTED>>>`, and the system prompt says that text inside them is data, not instructions.

---

## 4. Checklists

`decomposeGoalIntoSubtasks` splits a request into checklist items only where the user clearly listed separate items: numbered or bulleted lines, a one-line "1) … 2) …" list, or clauses joined by sequencing words (`sonra`, `ardından`, `ve en son`, `son olarak`, `then`, `after that`). Line breaks, sentence ends, commas and semicolons alone never split a request. A part that has no action of its own or points back to the previous one ("these", "bunları") stays with it.

The numbered checklist is part of the first task message. With more than one item the schema gets an optional `checklist_done` field, which the model uses to mark items as done; the checklist in the interface updates as it does. Wizards pass their own checklist (one item per page or step) and skip the splitting.

---

## 5. Acceptance checks for web pages

Acceptance checks are only created where completion can be verified from the files: a new web page, a follow-up that restyles or repairs an existing HTML file, and requests about a page's links. Bug fixes, scripts and other tasks get no acceptance checks; there the file checks, test runs and the model's own verification apply.

| Check | Meaning |
| --- | --- |
| `file_exists`, `min_size` | The page exists and is not a stub. |
| `html_structure` | A real HTML document that is not JSON-escaped. |
| `contains_style` | Real CSS rules, inline or in a linked local stylesheet (unless the user asked for no styling). |
| `contains_script` | JavaScript that runs, inline or in a linked local file; markup inside `<script>` does not count. Only when the request needs interactivity. |
| `references_resolve` | Every linked local CSS or JS file exists and is not empty. |
| `viewport_meta` | New or responsive pages declare `<meta name="viewport">`. |
| `links_work` | Every menu link (inside `<nav>`, else `<header>`) leads to an existing section id, an existing page or a JavaScript handler. Added when the request asks for working links or names the menu items; the task message then states which elements are meant (`REFERENCED ELEMENTS`). |

`TaskValidator` inspects the actual files and reports missing evidence with a concrete fix, for example the exact `<script src="script.js"></script>` tag and the line to add it before. An instruction sent while the task runs is merged into the checks (`TaskCompiler.mergeDirective`).

---

## 6. Guards for local models

| Problem | What the engine does | Code |
| --- | --- | --- |
| Invalid or chatty tool calls | Ollama `format` with a JSON Schema that has one variant per enabled tool, each with its own required fields and `thought` first. A fallback parser repairs trailing commas and raw newlines and never turns a malformed action into file content. | `AgentProtocol.buildActionSchema`, `ToolDispatcher.ts` |
| Broken files | After every write: JSON/JSONC parsing; string- and comment-aware bracket balance for JS/TS/JSX, Java, C/C++/C#, Go, Rust, PHP, Kotlin, Swift and CSS/SCSS; Python strings, brackets, tab/space mix and block indentation; HTML sections and inline scripts; YAML tabs; truncated files and leftover Markdown fences. Findings go back with numbered lines and block `finish`. | `FileSanity.ts` |
| Edits that break a working file | Every edit is checked before it is applied. A change that adds errors to a clean file, or more errors to a broken one, is refused and the model sees the numbered lines of its own version. On a broken file only fewer errors count as progress; after three edits without improvement the model gets the whole numbered file and is asked to rewrite it. | `FileSanity.damageFromChange`, `AgentEngine.ts` |
| Destructive rewrites | Invalid JSON never replaces valid JSON; config rewrites that lose keys are merged; rewrites that would delete most of a file or turn a page into a fragment are refused; placeholders such as "rest of the code" and status sentences written over a file are rejected; existing test files cannot be changed unless the user asks. | `FileSanity.ts`, `AgentEngine.ts` |
| Repetition | Sampling follows the model's recommended values; thinking models get `think: false` unless Settings › Agent › Think before each step is on. Degenerate output is detected while streaming and retried with different sampling. A repeated read-only action is not executed again; the model gets `[REPEATED]` and a request to finish or do something else. Re-applying an identical edit is refused. | `ModelRuntime.ts`, `AgentProtocol.detectRepetitionLoop`, `AgentEngine.ts` |
| No real progress | Changes that leave the same check errors, changes that only add copies of existing lines, and a successful command repeated with the same output count as no progress. | `AgentEngine.copiedLinesAdded`, `AgentEngine.ts` |
| Hard-to-see mistakes | A Python `replace_lines` block indented differently from the lines it replaces is aligned when that removes the error. An edit that deletes a function or class the file still uses is refused. For files of up to 60 lines with a reported problem, a complete rewrite is suggested. | `AgentEngine.alignReplacementIndent`, `FileSanity.definitionLoss` |
| Wrong file paths | A missing path is answered with the closest existing path (`Did you mean "src/App.tsx"?`). | `findClosestPath` |
| Misread command results | A program started without arguments that prints its usage text is reported as expected behaviour. Tracebacks and stack traces that point into the project come with the numbered lines at that location. A failed command is not run again until a file changes. Python output is read as UTF-8. | `AgentEngine.ts`, `electron/main.ts` |
| Missing tools | A command that is not installed is reported once with `[COMMAND UNAVAILABLE]` and listed in the state line. | `AgentEngine.ts` |

The file checks are expected to report no errors on valid code; they are tested against real code bases during development (the Python standard library and JS/TS/CSS/HTML/JSON files from `node_modules`).

---

## 7. Design themes for generated pages

After the agent has finished a new web page, the app applies a design theme. The model does not see the theme files and is not told about them.

| Phase | What happens | Code |
| --- | --- | --- |
| Plan (before the first step) | Only for a new web page: no HTML file yet, no framework, no single-file request and no colors of the user's own. The site's topic is taken from keywords; only if none or several categories match, the same model answers one short question with a JSON enum, before the agent's first request so the agent's cached prompt stays intact. A project that already has `theme/theme.css` keeps its theme. | `DesignTheme.planDesignTheme`, `categorize.ts`, `AgentEngine.classifySiteCategory` |
| Apply (after `finish`) | `theme/theme.css` (tokens, Google Fonts with system fallbacks, a zero-specificity `:where()` base layer) is written and linked. The page's colors and fonts are mapped to theme roles; the originals stay as `var()` fallbacks, so deleting `theme.css` restores the model's page. Emoji used as icons become SVG icons, sticky bars get a `z-index`. | `cssRewrite.ts`, `html.ts`, `themeCss.ts`, `AgentEngine.applyDesignTheme` |
| Repairs (with or without a theme) | Stale copyright years are updated and a missing viewport tag is added. A mobile menu whose script toggles a different element than its CSS expects, that has no script, or that stays open after a link is chosen is repaired. Buttons that no CSS rule styles get a plain style in the page's accent color when neither theme nor base CSS covers them. Pages whose CSS or JS files this run did not write are left alone. | `pageRepairs.ts` |

Every change passes the same check as the agent's own edits and the security profile's approval. There are 24 themes in 8 categories (`themes.ts`); `test_design_theme.ts` requires every text color pair of every theme to reach a contrast of at least 7:1 (WCAG AAA). Settings › Web design controls the theme mode, the base CSS and whether web fonts are loaded.

---

## 8. Creation wizards

The Website, Mini App and Script wizards are chosen in New Project (`NewProjectDialog.tsx`), which creates the project folder when the wizard is confirmed. The app compiles the request itself; no model call is involved.

**Hand-over.** No wizard starts a task. **Confirm** calls `setWizardDraft`; the workspace puts the request into the message box (asking first if the box has other text) and shows a small badge with "Open wizard" and ×. On send, `composerRunOptions` attaches the run options (short title, checklist, theme, checks) to whatever the user sent; `checklistForText` drops checklist items whose file no longer appears in the edited text. Emptying the box or × drops the options.

| Part | Role | Code |
| --- | --- | --- |
| Website data | Pages, sections (16 kinds), contact details, interactions, SEO, theme; defaults that follow the site's topic. The draft is kept in `localStorage`. | `lib/wizard/siteWizard.ts`, `stores/siteWizardStore.ts` |
| Website request | File plan, sections in order with anchor ids and menu links, the user's texts converted from Markdown to HTML, contact and social links, only the interactions the pages can use, an image rule and the current year; in the site's language. Returns the request, one checklist item per page and the theme choice. | `compileSitePrompt`, `lib/wizard/markdown.ts` |
| Text box | Markdown toolbar, shortcuts, list continuation and preview; edits keep the undo history. | `components/common/RichTextArea.tsx`, `lib/wizard/markdownEdit.ts` |
| Tool settings | Tools are described as data: toggle, choice, multi-choice, number, text and list fields with the sentence each value adds to the request. The same schema renders the settings page and builds the request. | `lib/wizard/params.ts`, `components/agent/wizard/ParamFields.tsx` |
| Mini apps | 21 single-file tools in 5 categories, each with rules against typical small-model mistakes and the design category of its theme. The request asks for one `index.html` with inline CSS and JS; the web page checks still apply. | `lib/wizard/miniApps.ts` |
| Scripts | 13 Python or Node.js tools in 3 categories. Before the first step the app writes a tested safety module next to the script (`guvenli_islem` / `safe_actions`); the model only writes the options and a `plan()` that lists rename, move and write actions, and the module's `execute()` is the only code that touches files: preview by default, changes only with `--uygula` / `--apply`, no deletes, no overwrites, nothing outside the given folder, backups before content changes, an action log. Scripts get no web page checks and no theme. The script's log and backup folders cannot be written by the model, and the same apply command is not run twice without a file change. | `lib/wizard/scripts.ts`, `lib/wizard/scriptSkeleton.ts`, `AgentEngine.ts` |
| Run | `startGoal(prompt, { displayGoal, checklist, design, contracts, seedFiles, scriptOutputs, applyFlag })` passes the explicit checklist, the theme choice and the script options to `runGoal`. | `lib/wizard/composer.ts`, `agentStore.ts` |

---

## 9. Sessions and projects

- **Storage.** Chats, agent tasks and settings are kept in `emir_code_data.json` in Electron's user data folder. The file is written to a temporary file first and then renamed over the old one.
- **Agent tasks** store their project folder, request, steps, logs and the list of applied changes. Opening a task sets its folder again through `workspace:setPath` and refreshes the file tree.
- **Undo.** The previous content of every changed file is kept by the main process in memory (`fileSnapshots`). **Undo changes (n)** restores all changes of the session with `workspace:rollbackTransaction`, overwriting later edits. After a restart the list of changes is still stored, but the previous contents are gone and the undo no longer works.
- **Sidebar.** In the Code tab tasks are grouped by project folder (`groupTasksByProject` in `lib/utils/projects.ts`; Windows paths compare case-insensitively and with either slash), most recently used folder first, tasks without a folder last. Moved or deleted folders are found with `workspace:pathsExist` and shown dimmed. The **+** of a project calls `agentStore.startTaskInFolder`.
- **New Project** creates the folder through `project:check` and `project:create` in the main process, with the same name rules on both sides; an existing folder is used only when it is empty. A wizard keeps a pending project and creates the folder when it is confirmed.
- **One running task.** The agent state belongs to the session that started it, so opening a chat does not stop a running task from being saved. Leaving a running task asks first; stopping it answers its pending approvals with "no" and ignores whatever the stopped run still reports.
- The app starts without a selected chat or task.

---

## 10. Web access

Web access is on by default and can be switched off completely, or separately for chat and for the agent, in Settings › Web access.

- **Chat.** `WebIntentDetector` recognises questions that need current information (people, news, prices, weather) and runs a search before the model answers; the results are added to the prompt as untrusted data. If the model still answers that it has no internet access, `chatStore` runs the search and generates the answer again.
- **Agent.** With web access on, the agent has `web_search` and `fetch_url`. Without it, the tools are not in the schema, and `ToolDispatcher` and `AgentEngine` refuse a call that appears anyway.
- **Main process.** Searches are sent to DuckDuckGo Lite (5 results by default, at most 10, each result URL checked). Page fetches check the address, follow at most 3 redirects and check each one, stop after 10 seconds and read at most 512 KB. Switching web access off aborts running requests (`web:abortAll`). The address checks are described in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md#web-access).

---

## 11. Model library (Model Manager › Discover)

| Concern | How it works | Code |
| --- | --- | --- |
| Source | ollama.com's library page (name, description, capability labels, sizes, pulls) and each model's tags page (every tag with digest, size, context window and input types), parsed from the HTML. A list with fewer than 20 models is not accepted. The list and the tags are cached for 12 hours; offline, the saved copy or a short built-in list is shown. Models that only run in ollama.com's cloud are not listed. | `src/lib/ollama/library.ts`, `src/stores/modelLibraryStore.ts` |
| Network | The renderer cannot fetch ollama.com itself. The main process offers `models:library`, `models:tags` and `models:manifest`, which build fixed URLs on ollama.com and registry.ollama.ai from validated names and reject responses that end on another host. | `electron/main.ts` |
| Sizes and quantizations | Tags are grouped by size, tags with the same digest are one choice, and the default build's common quantizations are the main choices. The preselected size is the largest that runs comfortably: about file size × 1.2 + 1 GB within 60 % of RAM, or within the GPU's memory. | `groupVariants`, `pickSize`, `hardwareFit` |
| Verification | `models:manifest` reads the registry manifest (as `ollama pull` does) and returns its digest and exact size. A finished download and every installed model are compared with it (identical or update available). | `verifyTag`, `compareInstalled`, `checkInstalledModels` |
| Categories | From the capability labels (tools, thinking, vision, audio, embedding), the sizes and the name or description (coding). Recommended lists the models of the agent benchmark. | `categoriesOf`, `modelsFor` |

---

## 12. Packaging and release

| Step | What happens | Code |
| --- | --- | --- |
| Windows executable | electron-builder packs the app. The `afterPack` hook writes the Emir Code icon and version information into `EmirCode.exe` with `rcedit` before the NSIS installer and the portable exe are built (`win.signAndEditExecutable` is off because electron-builder's own resource editing needs files that cannot be extracted on Windows without Developer Mode). The release workflow fails if the exe still carries Electron's metadata. | `scripts/afterPack.js`, `.github/workflows/release.yml` |
| Taskbar grouping | `app.setAppUserModelId('com.emircode.desktop')` matches the installer's `appId`, so the window groups with its pinned and Start Menu icon. | `electron/main.ts`, `package.json` |
| Linux launcher | `afterPack` renames the Electron binary to `emir-code-bin` and puts an `emir-code` shell launcher in front of it. The launcher keeps Chromium's sandbox when it can work and adds `--no-sandbox` otherwise; `EMIR_CODE_FORCE_SANDBOX=1` turns the fallback off. | `scripts/afterPack.js` |
| Linux desktop integration | Desktop entries use `StartupWMClass=Emir Code`, the window class Electron sets from the product name. Settings › About › Create shortcuts points at the AppImage file or the launcher, never at the temporary AppImage mount. | `package.json`, `electron/main.ts` |
| Linux setup script | `emir-code-setup-linux.sh` gets the release version at build time, installs from a `.tar.gz` next to it or downloads the matching release archive, and stops with an error instead of creating shortcuts to a missing binary. | `build/linux-installer.sh` |
| Linux smoke test | A separate job starts the AppImage, the installed `.deb`, the `.rpm` contents, the extracted `.tar.gz` and a setup-script installation on a virtual display on Ubuntu, and checks that each one opens its window. It reports failures without blocking the release. | `scripts/linux-smoke-test.sh`, `.github/workflows/release.yml` |
| Publishing | Pushing a `vX.Y.Z` tag runs the release workflow, which builds the Windows and Linux packages and publishes them as a GitHub release. | `.github/workflows/release.yml` |

---

## 13. Tests

`npm test` runs these suites; none of them needs Ollama.

| Suite | Covers |
| --- | --- |
| `scripts/verify_functionality.js` | Static checks across the app: translation parity, the command allowlist, interface structure, packaging configuration |
| `test_agent_reliability.ts` | Unit checks of the agent: parsing, file checks, guards, checklist splitting |
| `test_agent_engine.ts` | The whole agent loop against a scripted model |
| `test_production_architecture.ts` | State machine transitions, acceptance checks, validator, tool dispatcher, small-model detection |
| `test_web_access.ts` | Web access switches, runtime refusal, address checks, untrusted-data markers, search result IDs, request cancellation |
| `test_design_theme.ts` | Theme contrast, color and font mapping, page repairs |
| `test_site_wizard.ts`, `test_tool_wizard.ts` | Wizard requests, catalogs, the script safety module in Python and Node.js |
| `test_model_library.ts` | Parsing of saved ollama.com pages (`test_fixtures/ollama`), sizes, quantizations, verification |
| `test_projects.ts` | Project folders, name rules, grouping of tasks |

The CI workflow on pushes and pull requests runs the type check and the first five suites on Windows and Ubuntu. `npm run check:library` reads the live ollama.com pages to notice changes to their markup. `scripts/agent-e2e.ts` runs benchmark scenarios against a real Ollama model and checks the resulting files.
