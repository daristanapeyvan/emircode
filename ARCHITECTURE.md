# Emir Code Architecture

Emir Code is an Electron app (React 19, TypeScript, Zustand, Tailwind CSS) that talks to a local Ollama server and, when the user adds an API key, to cloud providers (Ollama Cloud, Anthropic for Claude, OpenAI for GPT). This document describes how the parts fit together and where the code lives. Security details are in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).

---

## 1. Processes

| Process | Responsibilities | Code |
| --- | --- | --- |
| Main (Node.js) | Project folder access (path checks, reads, writes, undo copies), the command runner, the model library requests to ollama.com, app data storage, Ollama start-up, Linux desktop integration | `electron/main.ts` |
| | Which commands may run (section 11) | `electron/commandPolicy.ts` |
| | The isolated environment of commands (section 11) | `electron/sandbox.ts`, `native/windows/` |
| | Web search and page fetching (section 10) | `electron/web.ts` |
| | Read-only git with repository settings switched off | `electron/git.ts` |
| | Texts of the main process in the interface language | `electron/i18n.ts` |
| | Cloud providers: API keys, model lists, streamed answers (section 13) | `electron/cloud/` |
| Preload | Exposes the typed `window.electronAPI` bridge; the window runs with `contextIsolation: true` and `nodeIntegration: false` | `electron/preload.ts` |
| Renderer | The interface, the stores, the agent engine and all requests to the local Ollama (`/api/chat`, `/api/show`, `/api/pull`, …). Model calls go through `ModelGateway`, which sends cloud models to the main process. | `src/` |

The agent engine runs in the renderer. It never touches the disk itself: every read, write, command, web request and cloud model request goes through an IPC call to the main process, which checks it again. Links in the window never open a new Electron window or navigate it away; web addresses go to the system browser.

Texts the user sees come from the translation files (`src/lib/localization/translations`), also those of the main process and the agent engine. What the model reads (instructions, check results, errors) is English; the check results shown in the interface are rendered in the interface language (`checkTexts.ts`).

---

## 2. How an agent task runs

1. **Start.** `agentStore.startGoal` calls `AgentEngine.runGoal` with the request, the model, the security profile and the previous task of the session. The model always learns which files the previous task changed and whether it finished; the previous request itself is included only when the new request continues it ("continue", "devam et"), so an unrelated request does not resume old work.
2. **Probing.** The engine asks the main process for `git status` and the file list, and reads the model's size, native context length and capabilities from Ollama's `/api/show`, or for a cloud model from the provider's model list (`ModelRuntime.ts`, section 13). If Git is not available, the git tools are left out; for the Autonomous profile `ask_user` is left out; without web access the web tools are left out. Models up to 4.5B parameters get a shorter tool list without `search_code` and `delete_file`.
3. **Planning.** The request becomes a checklist only when the user wrote an explicit list or joined steps with sequencing words (section 4). For web pages, `TaskCompiler` creates acceptance checks (section 5). For a new web page, a design theme is chosen (section 7).
4. **Tool loop** (at most 35 steps and 50 tool calls, within the task time limit from Settings › General, 30 minutes by default; time spent waiting for the user is not counted):
   - The engine sends the static system prompt and the append-only history through `ModelGateway.chatStream` (Ollama's `/api/chat`, or a cloud provider), with the JSON Schema of the enabled tools as Ollama `format`.
   - The model answers with one action: `{"thought": …, "action": …, …fields}`. The tools are `list_dir`, `read_file`, `search_code`, `write_file`, `edit_file`, `replace_lines`, `delete_file`, `run_command`, `git_status`, `git_diff`, `web_search`, `fetch_url`, `ask_user` and `finish`.
   - Reads go through the main process. Writes and edits are checked (section 6), shown as a diff and, depending on the profile, approved by the user or applied directly. The main process then writes the file.
   - Every result goes back to the model with a one-line state (section 3).
   - The loop itself is in `AgentEngine.ts`; each tool has its own handler in `src/lib/agent/run/` (`readTools`, `writeTool`, `editTool`, `deleteTool`, `commandTool`, `webTools`, `askTool`, `finishTool`). The handlers share the run state through a context object (`run/context.ts`); helpers without state are in `engineHelpers.ts`.
   - Each step's timing is logged: model load, prompt reading (tokens and seconds) and generation.
5. **Finish.** `finish` is accepted when every acceptance check passes and no written file has open check errors. Otherwise the model gets `[CANNOT FINISH YET]` with the problems, at most twice. A change task that has not changed any file gets `[CHECK]` once. After `finish` the design theme and the page repairs are applied, and the task ends with a completion card (green) or an incomplete card (amber) that lists what could not be verified.

The task stops early after 3 consecutive errors, 3 repeated actions in a row, 10 steps without progress, the step or tool-call limit, or the time limit. When it stops for repetition or lack of progress but every acceptance check already passes (or, for scripts, the model's own program ran successfully after its last change), it ends as completed with a note instead (`tryGracefulCompletion`). A task without acceptance checks and without code to run (a stylesheet or text change) also ends as completed when the model re-sends, at least twice, a change that is already in the file. When the same edit is refused again for the same fault, the model gets the current lines of the file and one different way to make the change (the complete file for short files, the whole block otherwise).

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
- **Context length.** Every request to Ollama sends an explicit `num_ctx`. It comes from Settings › Agent › Context length (Auto: chosen for this computer's hardware and capped by the model's native context). Chats use the same value unless a chat has its own override, so Ollama does not reload the model when you switch modes. Cloud models use Settings › Cloud models › Context window instead (section 13).
- **Compaction.** The engine estimates the prompt size before each request. When the prompt would not leave room for the answer, older tool results and actions are shortened (the newest exchanges stay complete; how many depends on the model tier). If that is not enough, the oldest exchanges are dropped and replaced by a short note that names the changed files. A file body removed from history is replaced by a line such as `[read_file "src/App.tsx": 870 lines, content removed from history to save space; read it again if you need it]`.
- **Small projects.** In projects with up to 6 files (12 for large models) the current file contents are part of the first task message, up to a quarter of the context window (large models: 30 %, at most 48,000 characters). When the model asks to read such a file anyway, the first read is answered; after that the rule for repeated reads applies.
- **Model tiers.** `modelTier` (`ModelRuntime.ts`) sorts a model into *small* (≤ 4.5B: the leanest prompt and tool set), *medium* (a typical local model) or *large* (≥ 24B locally, or any cloud model). `agentLimitsFor` (`src/lib/agent/agentLimits.ts`) turns the tier and the context window into the run's limits. Small and medium models keep the limits tuned on 2–8B models (35 steps, 50 tool calls, reads cut at 16,000 characters, 4 kept exchanges). Large models get 60 steps and 90 tool calls, reads sized to 15 % of the window (16,000–60,000 characters), `read_files` for up to 8 files in one step, 8 kept exchanges when the history is compacted (and compaction down to 60 % of the budget, so it happens rarely and the provider's prompt cache survives), and three working-style rules in the system prompt instead of small-model hand-holding ("read everything first, then change, then verify"; prefer focused edits; keep thoughts short and do not add unrequested features). Every value stays bounded by the context window, so a large local model with an 8K window is not overfed. The base stylesheet of the design theme is off for large models.
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
| Edits that break a working file | Every edit is checked before it is applied. A change that adds errors to a clean file, or more errors to a broken one, is refused and the model sees the numbered lines of its own version. On a broken file only fewer errors count as progress; after three edits without improvement the model gets the whole numbered file and is asked to rewrite it. | `FileSanity.damageFromChange`, `run/editTool.ts`, `run/writeTool.ts` |
| Destructive rewrites | Invalid JSON never replaces valid JSON; config rewrites that lose keys are merged; rewrites that would delete most of a file or turn a page into a fragment are refused; placeholders such as "rest of the code" and status sentences written over a file are rejected; existing test files cannot be changed unless the user asks. | `FileSanity.ts`, `run/writeTool.ts` |
| Repetition | Sampling follows the model's recommended values; thinking models get `think: false` unless Settings › Agent › Think before each step is on. Degenerate output is detected while streaming and retried with different sampling. A repeated read-only action is not executed again; the model gets `[REPEATED]` and a request to finish or do something else. Re-applying an identical edit is refused. | `ModelRuntime.ts`, `AgentProtocol.detectRepetitionLoop`, `AgentEngine.ts`, `run/` |
| No real progress | Changes that leave the same check errors, changes that only add copies of existing lines, and a successful command repeated with the same output count as no progress. | `engineHelpers.copiedLinesAdded`, `AgentEngine.ts` |
| Hard-to-see mistakes | A Python `replace_lines` block indented differently from the lines it replaces is aligned when that removes the error. An edit that deletes a function or class the file still uses is refused. For files of up to 60 lines with a reported problem, a complete rewrite is suggested. | `engineHelpers.alignReplacementIndent`, `FileSanity.definitionLoss` |
| Wrong file paths | A missing path is answered with the closest existing path (`Did you mean "src/App.tsx"?`). | `engineHelpers.findClosestPath` |
| Misread command results | A program started without arguments that prints its usage text is reported as expected behaviour. Tracebacks and stack traces that point into the project come with the numbered lines at that location. A failed command is not run again until a file changes. Python output is read as UTF-8. | `run/commandTool.ts`, `electron/main.ts` |
| Missing tools | A command that is not installed is reported once with `[COMMAND UNAVAILABLE]` and listed in the state line. | `run/commandTool.ts` |

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
| Scripts | 13 Python or Node.js tools in 3 categories. Before the first step the app writes a tested safety module next to the script (`guvenli_islem` / `safe_actions`); the model only writes the options and a `plan()` that lists rename, move and write actions, and the module's `execute()` is the only code that touches files: preview by default, changes only with `--uygula` / `--apply`, no deletes, no overwrites, nothing outside the given folder, backups before content changes, an action log. Scripts get no web page checks and no theme. The script's log and backup folders cannot be written by the model, and the same apply command is not run twice without a file change. | `lib/wizard/scripts.ts`, `lib/wizard/scriptSkeleton.ts`, `AgentEngine.ts`, `run/commandTool.ts` |
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

- **Chat.** `WebIntentDetector` recognises questions that need current information (people, news, prices, weather) by whole words in Turkish and English. Questions about code are not searched unless the user asks for a search. Before the model answers, `chatStore` searches, reads the first result page (up to 6,000 characters) and adds both to the prompt as untrusted data. The model can also ask for a search or a page itself. If it answers that it has no internet access or does not know, the app searches and generates the answer again. Stopping the answer cancels the web requests.
- **Agent.** With web access on, the agent has `web_search` and `fetch_url`. Without it, the tools are not in the schema, and `ToolDispatcher` and `AgentEngine` refuse a call that appears anyway.
- **Main process** (`electron/web.ts`). Searches are sent to DuckDuckGo Lite (5 results by default, at most 10, each result URL checked); when DuckDuckGo's page layout is not recognised, the search reports an error instead of "no results". Page fetches check the address, resolve the host name at connection time and refuse private addresses, follow at most 3 redirects and check each one, stop after 10 seconds and read at most 512 KB (after decompression, as a stream). Only text, HTML, XML and JSON are read; the character set is taken from the response or the page. Every request has an id; `web:abort` cancels one, and switching web access off cancels all (`web:abortAll`). The address checks are described in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md#web-access).
- **Renderer.** `WebAccessService` only calls the main process; the renderer never fetches web pages itself.

---

## 11. Commands and isolation

| Step | What happens | Code |
| --- | --- | --- |
| Rules | `checkCommand` decides what may start: `npm`, `node`, `python`, `pytest` and `cargo`; npm only for `test` and `run test|build|lint|typecheck|check`, with a `package.json` that has the script, and without npm options; no shell characters (on Windows also none that cmd.exe reads inside quotes); no code on the command line (`node -e`, `-p`, `--eval`, `data:` imports, `python -c`); `python -m` only for `pytest`, `unittest`, `doctest` and `py_compile`; a fixed list of cargo subcommands. A refusal has a code and a translation key, so the engine reacts to the code, not to the text. | `electron/commandPolicy.ts` |
| Before approval | The engine checks the same rules before it asks the user, so a refused command never reaches the approval dialog. For `npm test` and `npm run` it reads the script from `package.json`, and it asks the main process how the command will run (`sandbox:plan`): isolated, write-protected or neither, with a warning when the folder next to the project is open to every account. The dialog shows all of it. | `run/commandTool.ts` |
| Approval | Strict and Balanced ask for every command. Autonomous runs an isolated command directly; any other command only while it is a known test command and the task has not written code yet. | `run/commandTool.ts` |
| Start | The main process checks the rules again and starts the program without a shell (npm on Windows through cmd.exe as one command string, which Node requires for `.cmd` files). The environment is reduced to the system variables programs need (`commandEnvironment`); API keys and tokens in the app's environment are not passed on. The time limit is 60 seconds; on POSIX the program gets its own process group, so the limit stops everything it started. Output is kept up to 2 MB. | `electron/main.ts`, `electron/sandbox.ts` |
| Windows launcher | `emir-sandbox.exe` (C#, built with the .NET Framework compiler that ships with Windows by `scripts/build-sandbox.cjs`) starts every command, with only its standard handles inherited, inside a job object. A setup failure exits with code 125 and an `emir-sandbox:` line, which the main process reports as such instead of as a failed test. Before a command runs, `--prepare` opens the project folder to it; that can take a while on a large folder and is not part of the command's time limit. | `native/windows/EmirSandbox.cs` |
| Windows: full isolation | Set up once by an administrator (`--setup`): two hidden local accounts, a group, and a block on one account's outgoing connections (filters in the Windows Filtering Platform and a firewall rule; localhost stays open). The launcher logs the account on (`CreateProcessWithLogonW`) and starts itself as that account on a hidden desktop inside the user's window station (a process of another account does not start on a separate window station); that copy starts the program with a restricted token whose restricting identities are the account, the sandbox group, Users and Everyone. Whole process trees run this way. | `native/windows/Accounts.cs`, `Restricted.cs`, `Filters.cs` |
| Windows: without the setup | One program that starts no others (`python`, `node file.js`) runs in the AppContainer `EmirCode.Sandbox`; folders are opened to a capability of the container, not to the container's own identity, which would close them to low-integrity programs. Node gets `node-guard.cjs` as a preload, which makes attempts to start other programs fail at once (libuv retries forever on the named pipes an AppContainer may not create). Everything else runs write-protected: a token of the low integrity level, the project folder labelled as writable for it. | `native/windows/EmirSandbox.cs`, `Restricted.cs`, `Access.cs` |
| Linux isolation | `bwrap` with every namespace unshared (`--share-net` only with the network setting), the system mounted read-only, private home and `/tmp`, the project folder writable and language tool folders (`.nvm`, `.pyenv`, `.cargo`, `.local/lib`, …) read-only. | `linuxMounts` in `electron/sandbox.ts` |
| Status | The first time a command is planned or Settings › Agent opens (`sandbox:status`), the app checks once what works here: on Windows whether full isolation is set up, starts a program and has its network blocked (a real connection attempt as the account), and whether Python and Node start in the AppContainer; on Linux whether `bwrap` starts. `sandbox:setupFull`, `sandbox:removeFull` and `sandbox:allowPython` ask Windows for an administrator; the app never changes these things on its own. | `Sandbox` in `electron/sandbox.ts`, `IsolationSettings.tsx` |

`npm run test:sandbox` (`test_sandbox.ts`) tries this for real on the current system: an isolated program reads and writes in the project folder, cannot read or write a file next to it or list the home folder, and has no internet without the network setting. On Windows it also runs `npm test` as a process tree: fully isolated where the separate account is set up (CI sets it up), write-protected otherwise.

---

## 12. Model library (Model Manager › Discover)

| Concern | How it works | Code |
| --- | --- | --- |
| Source | ollama.com's library page (name, description, capability labels, sizes, pulls) and each model's tags page (every tag with digest, size, context window and input types), parsed from the HTML. A list with fewer than 20 models is not accepted. The list and the tags are cached for 12 hours; offline, the saved copy or a short built-in list is shown. Models that only run in ollama.com's cloud appear only in the Cloud category and in a search. | `src/lib/ollama/library.ts`, `src/stores/modelLibraryStore.ts` |
| Network | The renderer cannot fetch ollama.com itself. The main process offers `models:library`, `models:tags` and `models:manifest`, which build fixed URLs on ollama.com and registry.ollama.ai from validated names and reject responses that end on another host. | `electron/main.ts` |
| Sizes and quantizations | Tags are grouped by size, tags with the same digest are one choice, and the default build's common quantizations are the main choices. The preselected size is the largest that runs comfortably: about file size × 1.2 + 1 GB within 60 % of RAM, or within the GPU's memory. | `groupVariants`, `pickSize`, `hardwareFit` |
| Verification | `models:manifest` reads the registry manifest (as `ollama pull` does) and returns its digest and exact size. A finished download and every installed model are compared with it (identical or update available). | `verifyTag`, `compareInstalled`, `checkInstalledModels` |
| Categories | From the capability labels (tools, thinking, vision, audio, embedding, cloud), the sizes and the name or description (coding). Recommended lists the models of the agent benchmark. Cloud lists every model with a cloud offer, cloud-only ones included. | `categoriesOf`, `modelsFor` |
| Cloud tags | Tags such as `120b-cloud` or `cloud` form their own group (`CLOUD_GROUP`) after the sizes; they have no memory fit and are preselected only for a cloud-only model. Adding one pulls the small manifest through the local Ollama, which then runs the model on ollama.com once signed in (section 13). | `isCloudTagName`, `groupVariants`, `pickSize` |

---

## 13. Cloud models

Ollama Cloud, Claude, GPT, Gemini, Mistral and OpenAI-compatible servers run next to the local models. The plan behind this, in Turkish, is [docs/PLAN_BULUT_MODELLERI.md](./docs/PLAN_BULUT_MODELLERI.md); the 2.x roadmap and its status are in [docs/PLAN_ACIK_NOKTALAR.md](./docs/PLAN_ACIK_NOKTALAR.md).

**Model references.** Local models keep their plain Ollama names. A cloud model is stored as `provider::model` (`anthropic::claude-opus-5-5`, `openai::gpt-5`, `gemini::gemini-2.5-pro`, `mistral::mistral-large-latest`, `ollama-cloud::gpt-oss:120b`); `::` occurs in no Ollama name, so everything saved earlier still means a local model. A model of an OpenAI-compatible server is `openai-compatible:<server id>::<model>` (`openai-compatible:openrouter::qwen/qwen3-coder`). An Ollama Cloud model added to the local Ollama after `ollama signin` keeps its plain name with a `-cloud` tag (`gpt-oss:120b-cloud`) and is an ordinary local model that runs remotely. Helpers: `src/lib/providers/modelRef.ts` (`providerName`, `providerCompany`, `runsInCloud`, `cloudOwner`); a server on this computer does not count as cloud.

| Part | What it does | Code |
| --- | --- | --- |
| Gateway | `ModelGateway.chatStream` has the signature of `OllamaClient.chatStream`. A local model goes to Ollama; a cloud model goes to the main process with a request id (`cloud:chat`), and the answer comes back as Ollama chunks over `cloud:event` (`chunk`, then `end` or `error`). Stopping aborts the signal, rejects with an `AbortError` and sends `cloud:abort`. Errors arrive as `CloudRequestError` with a code (and, for limits, when they reset). Callers add `effort`, `summaries` and `nativeTools`; they are dropped for local models. | `src/lib/providers/ModelGateway.ts` |
| Main-process service | Checks every request field by field (provider, model id, roles, size up to 48 MB, numeric options only, known effort levels), runs it and streams the events to the window that asked; a closed window's requests are aborted. Also lists models, describes one model, saves or removes keys, and adds or removes OpenAI-compatible servers. | `electron/cloud/index.ts` |
| Keys | One file, `cloud_keys.json` in the app's data folder (mode 600), with each key encrypted by Electron `safeStorage`. Where safeStorage has no real key store (Linux `basic_text`), a key is kept in memory for the session. Keys from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` and `OLLAMA_API_KEY` are used when none is saved. A key is saved only after the provider's model list could be read with it. A server's key is encrypted together with the server's address and only handed out for that address. The window gets the source and the last four characters, never a key. | `electron/cloud/keyStore.ts` |
| OpenAI-compatible servers | Definitions (id, name, normalized base URL, local flag) in `cloud_endpoints.json`, no secrets; entries edited by hand must pass the address rules again. `https` always; `http` only for loopback and, when the user marks the server as on the local network, for private addresses; no credentials, query or fragment in the address. A server is saved only after its model list could be read. Addresses cannot be edited (remove and add again). | `electron/cloud/endpoints.ts` |
| Claude | `@anthropic-ai/sdk`, `beta.messages.create` with streaming, fixed `https://api.anthropic.com` (an `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` in the environment is ignored). No sampling parameters. Top-level `cache_control` caches the static system prompt and the append-only history. Think → `thinking: {type: "adaptive", display: "summarized"}`, or a token budget on models without adaptive thinking. The answer schema → `output_config.format`; the effort setting → `output_config.effort` at the nearest level the model lists (`capabilities.effort` of the Models API). Models with safety classifiers get `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). A request the server rejects because of the fallback field or the effort level is sent once more without it, if nothing was written yet. | `electron/cloud/anthropic.ts` |
| GPT | `openai` SDK, fixed `https://api.openai.com/v1`. Reasoning models (o-series, GPT-5) use the **Responses API** (`store: false`, `instructions`, `reasoning.effort`, `reasoning.summary: "auto"` when summaries are on; summaries stream as thinking). Other models use Chat Completions with usage. No sampling parameters. The answer schema → a non-strict `json_schema` format. Rejected reasoning settings are dropped for one retry. The model list keeps chat models (no embeddings, audio, images or dated snapshots); context windows are known per family. | `electron/cloud/openai.ts` |
| Mistral | The same Chat Completions code with the Mistral dialect, fixed `https://api.mistral.ai/v1`: `max_tokens`, no OpenAI-only fields; Magistral's typed thinking chunks become thinking. The model list comes with context windows and vision. | `electron/cloud/openai.ts` |
| Compatible servers | The same Chat Completions code with the compatible dialect at the server's own address: `max_tokens`, the request's temperature, the answer schema as `json_schema` (a server that rejects it falls back like any provider), no native tools. Context windows are read from the model list when the server gives them (`context_length`, `max_model_len`, `max_context_length`). | `electron/cloud/openai.ts` |
| Gemini | `@google/genai`, fixed `https://generativelanguage.googleapis.com`, `vertexai: false`. System prompt → `systemInstruction`, images → inline data, the answer schema → `responseJsonSchema` (merged), effort → `thinkingLevel` (Gemini 3) or `thinkingBudget` (2.5), think → `includeThoughts` (thought parts stream as thinking). Blocked prompts and answers become refusals with their reason. | `electron/cloud/gemini.ts` |
| Ollama Cloud | `https://ollama.com/api/chat`, `/api/tags` and `/api/show` with the key as a bearer token; redirects are refused. The request and the answer are Ollama's own. | `electron/cloud/ollamaCloud.ts` |
| Redirects | Every client fetches with `redirect: "error"` (Ollama Cloud: `manual`), so a key is never sent to an address it was not saved for. Clients for other hosts get none of OpenAI's organization or project headers from the environment. | `electron/cloud/openai.ts`, `gemini.ts`, `ollamaCloud.ts` |
| Answer schema | Claude's, OpenAI's and Gemini's structured outputs do not take the agent's `anyOf` of tool variants with length limits. `flattenSchema` merges the variants into one closed object (`action` as an enum, tool fields optional, `thought` first) and removes unsupported keywords. | `electron/cloud/schema.ts` |
| Native tools (experimental) | With Settings › Cloud models › Experimental on, Claude and GPT get one tool per action of the answer schema instead of a JSON format (Claude: `tool_choice: any`, no thinking; GPT: `tool_choice: required`, Chat Completions). The agent's history is rewritten as tool calls and tool results, and the provider's tool call comes back as the same JSON action text, so the agent and its checks do not change. | `electron/cloud/nativeTools.ts` |
| Errors | Provider errors become codes: `no_key`, `auth`, `quota`, `usage_limit`, `rate_limit`, `overloaded`, `not_found`, `format_unsupported`, `think_unsupported`, `context_length`, `refusal`, `network`, `bad_request`. `usage_limit` (Ollama Cloud's hourly and weekly limits, spending limits) carries when it resets, from the text or `Retry-After`. Every error text is stripped of the known keys and of anything key-shaped (`redactSecrets`). The interface shows the codes in its language; the agent switches the schema or the think parameter off after `format_unsupported` / `think_unsupported` and repeats the step. The SDKs retry 429, 5xx and connection errors. | `electron/cloud/errors.ts`, `src/lib/providers/errorText.ts` |

**The agent on a cloud model.** `getModelRuntimeInfo` marks cloud models (and `-cloud` tags) as remote, never small and of the *large* tier (section 3); a model of a server on this computer is a local model sized by its name. `resolveRequestProfile` then takes the context window from Settings › Cloud models (Automatic: 65,536 tokens, capped by the model) instead of the hardware, and allows 16,384 output tokens per step (capped by the model and half the window). The design-category question gets 1,024 output tokens, because cloud models may reason first. Each step carries *Effort of the agent* and, when on, the native tool mode. The first log line names the provider that receives the task. Everything else (prompt, schema, checks, approvals, isolation) is the same as for a local model; the chunk translation keeps `done_reason: "length"`, `prompt_eval_count` and the cached part, so the output limit and the token estimate calibrate as with Ollama.

**Costs and the task budget.** `pricing.ts` holds list prices per million tokens (input, cached input, output) for models whose price was known when the version was made (`PRICES_AS_OF`), overridable per model in Settings › Cloud models › Prices; Ollama Cloud is a plan and local servers are free. The chat shows the estimated cost of an answer; the engine adds up the usage of every call of a task (`usageSink`), puts tokens and cost on the final card, stops before a new step once the estimate reaches Settings › Cloud models › Task budget (with a notice at 80 %) and says so when the model's price is unknown.

**Interface.** Settings › Cloud models (`CloudSettings.tsx`, `src/components/settings/cloud/`) holds the providers' keys with the models each shows in the selector (`visibleModels.ts`: Claude's three newest, OpenAI's five newest, Gemini's newest, Mistral's `-latest`, all of Ollama Cloud and of small servers by default), the OpenAI-compatible servers (presets, the address rules, a confirmation before a remote server is added), the Ollama Cloud sign-in hint, effort and reasoning summaries, the context window, the task budget, the prices and the experimental native tool mode. The model selector groups models by provider and by server, lists hidden models only when searching (with "N more in Settings") and always lists the selected one. Model Manager › Discover has a Cloud category; a model's cloud tags form their own group that is added, not downloaded. The model store lists the models of every ready provider at start and after a key or a server changes (`refreshCloud`, `applyCloudStatus`, `cloudStatus.ts`). The "Ollama not detected" banner appears only while a local Ollama model is selected.

---

## 14. Packaging and release

| Step | What happens | Code |
| --- | --- | --- |
| Windows executable | electron-builder packs the app. The `afterPack` hook writes the Emir Code icon and version information into `EmirCode.exe` with `rcedit` before the NSIS installer and the portable exe are built (`win.signAndEditExecutable` is off because electron-builder's own resource editing needs files that cannot be extracted on Windows without Developer Mode). The release workflow fails if the exe still carries Electron's metadata. | `scripts/afterPack.js`, `.github/workflows/release.yml` |
| Command isolation launcher | `npm run build:installer` and the other build scripts first run `scripts/build-sandbox.cjs`, which compiles the C# files in `native/windows/` into `emir-sandbox.exe` with the .NET Framework compiler that ships with Windows and copies `node-guard.cjs` next to it. electron-builder puts both in `resources/sandbox`; the release workflow fails if the launcher is missing from the package. On other systems the script does nothing. | `scripts/build-sandbox.cjs`, `package.json`, `.github/workflows/release.yml` |
| Taskbar grouping | `app.setAppUserModelId('com.emircode.desktop')` matches the installer's `appId`, so the window groups with its pinned and Start Menu icon. | `electron/main.ts`, `package.json` |
| Linux launcher | `afterPack` renames the Electron binary to `emir-code-bin` and puts an `emir-code` shell launcher in front of it. The launcher keeps Chromium's sandbox when it can work and adds `--no-sandbox` otherwise; `EMIR_CODE_FORCE_SANDBOX=1` turns the fallback off. | `scripts/afterPack.js` |
| Linux desktop integration | Desktop entries use `StartupWMClass=Emir Code`, the window class Electron sets from the product name. Settings › About › Create shortcuts points at the AppImage file or the launcher, never at the temporary AppImage mount. | `package.json`, `electron/main.ts` |
| Linux setup script | `emir-code-setup-linux.sh` gets the release version at build time, installs from a `.tar.gz` next to it or downloads the matching release archive, and stops with an error instead of creating shortcuts to a missing binary. | `build/linux-installer.sh` |
| Linux smoke test | A separate job starts the AppImage, the installed `.deb`, the `.rpm` contents, the extracted `.tar.gz` and a setup-script installation on a virtual display on Ubuntu, and checks that each one opens its window. It reports failures without blocking the release. | `scripts/linux-smoke-test.sh`, `.github/workflows/release.yml` |
| Publishing | Pushing a `vX.Y.Z` tag runs the release workflow, which builds the Windows and Linux packages and publishes them as a GitHub release. | `.github/workflows/release.yml` |

---

## 15. Tests

`npm test` runs these suites; none of them needs Ollama or a cloud account.

| Suite | Covers |
| --- | --- |
| `scripts/verify_functionality.js` | Static checks across the app: translation parity, the command allowlist, interface structure, packaging configuration, cloud keys staying in the main process |
| `test_agent_reliability.ts` | Unit checks of the agent: parsing, file checks, guards, checklist splitting, model tiers and their limits |
| `test_agent_engine.ts` | The whole agent loop against a scripted model, including refused commands, follow-up tasks and the large-model tier (`read_files`, larger reads, preloading) |
| `test_production_architecture.ts` | State machine transitions, acceptance checks, validator, tool dispatcher, small-model detection |
| `test_web_access.ts` | Web access switches, runtime refusal, address checks, untrusted-data markers, HTML to text, search intent in Turkish and English (code questions stay local), request ids and cancellation |
| `test_design_theme.ts` | Theme contrast, color and font mapping, page repairs |
| `test_site_wizard.ts`, `test_tool_wizard.ts` | Wizard requests, catalogs, the script safety module in Python and Node.js |
| `test_model_library.ts` | Parsing of saved ollama.com pages (`test_fixtures/ollama`), sizes, quantizations, verification, the Cloud category and cloud tags |
| `test_cloud_providers.ts` | Model references, the flattened answer schema, the requests Claude, GPT and Ollama Cloud get, their streams translated into Ollama chunks, error codes, the key store (encrypted file, session-only keys, environment), the main-process request checks, the gateway (routing, errors, stopping), the runtime profile of cloud models and a whole agent task on a scripted cloud model |
| `test_cloud_features.ts` | Keys masked in error texts, usage limits, Claude's effort, OpenAI's Responses API and reasoning summaries, Gemini, Mistral, OpenAI-compatible servers (address rules, the key bound to its address, a real local HTTP server: adding, chatting, redirects refused, an address changed on disk), the native tool mode (tools, history, tool calls back to actions), prices and the default models of the selector, and the agent on a scripted cloud model (effort, native tools, tokens and cost, the task budget) |
| `test_projects.ts` | Project folders, name rules, grouping of tasks |
| `test_markdown.ts` | Numbered and nested lists in chat answers |
| `test_security.ts` | Command rules, credential and runner settings files, web address checks, search page parsing, read-only git against a repository with hostile settings |

`test_sandbox.ts` (`npm run test:sandbox`) tries the isolated environment of commands on the current system (section 11).

The CI workflow on pushes and pull requests runs the type check, every suite of `npm test` and `test_sandbox.ts` on Windows and Ubuntu (with bubblewrap installed). `npm run check:library` reads the live ollama.com pages to notice changes to their markup. `scripts/agent-e2e.ts` runs benchmark scenarios against a real Ollama model or a cloud model (through `scripts/cloud-bridge.ts`, which serves the main process's cloud service without Electron) and checks the resulting files; cloud results include tokens and the estimated cost. `scripts/cloud-smoke.ts` checks every provider with a key in the environment (also as the hand-started `Cloud smoke test` workflow).
