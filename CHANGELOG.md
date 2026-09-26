# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Documentation rewritten to match the app: README, the Turkish guide, the examples, architecture, security model, security policy, contributing guide and GitHub templates. The security model now also states the limits: file-change tokens are not an approval check, writes are not flushed to disk, undo copies are kept only in memory, deletes in the Files panel cannot be undone, and the web address check does not pin the resolved address.
- The package description in `package.json` describes what the app does.
- `GEMINI.md` (instructions for an AI assistant) is no longer part of the repository.

### Fixed
- The out-of-memory message pointed to Settings › Generation for the context length; it now points to Settings › Agent.

## [1.8.0] - 2026-09-26

### Added
- Model Manager › Discover lists the Ollama library from ollama.com in categories (Recommended, Coding, Agents & tools, Reasoning, Vision & audio, Lightweight, Chat & general, Embedding, All) with a search box. Models that only run in ollama.com's cloud are left out. The list loads when the tab opens and is kept for 12 hours; without a connection the saved copy or a short built-in list is shown.
- A model's page lists all its sizes and the quantizations of its default build (Q4_K_M, Q5_K_M, Q6_K, Q8_0, FP16, QAT), each with its file size, a short explanation and whether it fits this computer's memory. The largest size that runs comfortably is preselected; rarer quantizations and other builds are under "Other versions".
- Tags are checked in the Ollama registry before a download, together with their exact size. A finished download is compared with the registry digest, and the Installed tab shows for every model whether it is up to date. A model or tag typed by hand is checked before it is downloaded.
- The Model Manager contacts only ollama.com and registry.ollama.ai, through fixed addresses in the main process.
- `npm run check:library` reads the live ollama.com pages to notice changes to their markup.
- Projects in the Code tab's sidebar: tasks are grouped by project folder, most recently used first, and the open project is listed before its first task. The + next to a project starts a new task in it. A project folds with a click, shows its last 5 tasks with "Show more", and each task shows how long ago it was worked on, or a spinner while it runs. Moved or deleted folders are dimmed; old tasks without a folder are listed under "No folder". The Chat tab lists only chats.
- New Project (sidebar, Ctrl+Shift+N, command palette): an empty project, Website, Mini App or Script, a name and a location (Documents › Emir Code Projects by default; the last location is remembered). An empty project's folder is created right away; a wizard's folder is created when the wizard is confirmed, so a wizard closed halfway leaves nothing on disk, and the wizard shows the folder it will create. Names that are not valid folder names on Windows, macOS or Linux are refused while typing, and an existing folder is used only when it is empty. "Open an existing folder…" opens a project you already have.
- Ctrl+N in the Code tab starts a new task in the open project (New Project when none is open); the command palette has "New project" and "New task in the open project".

### Changed
- A plainer interface:
  - One dialog frame for every window; Escape closes only the top one, and approval dialogs close only with their buttons.
  - The app's own dropdown lists replace the operating system's (same look in both themes, grouped options, keyboard: arrows, Home/End, Enter, Escape, typing a letter), and the browser's confirm and alert boxes are replaced by the app's dialogs with a title and clear buttons (red for deleting, stopping or undoing). Escape closes an open dropdown first, then the dialog under it.
  - The agent's task is a plain log: thoughts as text, tool calls as one line with their result, your own messages like chat messages. The live block shows only what the model is writing and the elapsed time. The right panel is Logs (events and model output).
  - Approval dialogs show the file or command, the agent's reason and the buttons.
  - The project bar shows the project name (full path as a tooltip), "Approval: Strict / Balanced / Autonomous" with an explanation, "Undo changes (n)" (asks first when "Ask before deleting" is on), and the Files and Logs buttons.
  - Start screens show the mode's icon above a heading. A new chat names the model that will answer; the Code tab offers New Project and Open project folder, and shows the project's name, location and file count once one is open.
  - The wizards are started from New Project only; the suggestions above the message box were removed.
  - Chat messages have no avatars. Time, speed and the copy, edit and regenerate buttons appear on hover, and the model is named only when it changes. The system instructions button moved from the title bar to the message box.
  - Installed models are a plain list with their actions on hover; model details are one page and show a dash for unknown values.
  - Settings: Generation holds the sampling of the open chat; the agent's options moved to a new Agent page and the web themes to a Web design page; hardware is shown once, under About. Option names are plain.
  - The setup wizard has two steps (requirements, model).
  - Graphite accents for buttons, switches, sliders and tabs; blue only for the send button and the active switches in the message box. Red for danger, amber for warnings.
  - Rounder corners, and one spacing grid for the message box and the sidebar.
  - The agent mode is called Code (Chat · Code).
- The light theme now applies to the whole interface; before, choosing it changed almost nothing. Dark stays the default; the light theme uses calm grey surfaces, and the window opens in the saved theme's color.
- Interface texts are translated in both directions, including the built-in presets and system instructions. The agent engine's own task messages (for example the stop messages and the completion card title) are still in Turkish in both languages.
- The built-in model list shows gemma2 once, with both tested sizes.
- The + in the title bar was removed: new chats, projects and tasks start from the sidebar.
- The Files panel is closed by default; the tree button opens it and the choice is remembered.

### Fixed
- Opening another task, project or new task while a task was running left the run going in the background, and its steps landed in the newly opened session. The app now asks first, stops the run, answers its pending approvals with "no" and ignores whatever the stopped run still reports.
- A new task kept the previous task's undo list, so undo could roll back another task's changes, possibly in another folder.
- A running task stopped being saved as soon as a chat was opened in the Chat tab.
- Deleting the open chat selected the newest item of the other tab's list.
- Ctrl+N could act on the previously active tab instead of the current one.
- Model sizes below a billion parameters were shown in billions (all-minilm "33B" instead of "33M").
- The agent's code search ended the whole task because the main process had no handler for it. `search_code` now works (text or regular expression, inside the project folder, skipping ignored folders, hidden files and binaries, at most 200 matches), and a failing search is a tool error the model can work around.
- Mobile menus that did not open or close: models toggle a class on one element while their CSS expects it on another, write no script, or leave the menu open after a link is chosen. At the end of a run such menus are repaired; menus that already work, and pages whose CSS or script files the run did not write, are left alone.
- Buttons that no CSS rule styles get a zero-specificity style in the page's accent color when no theme covers them.

### Tests
- `test_design_theme.ts` covers the page repairs, and `test_agent_engine.ts` covers a failing code search.
- `test_model_library.ts` (with saved ollama.com pages in `test_fixtures/ollama`) and `test_projects.ts` join `npm test`.

## [1.7.0] - 2026-09-26

### Added
- Design themes for new web pages: after the agent has finished a new page, one of 24 themes in 8 categories is applied. Each theme has its own palette, type pairing, shapes, shadows, button style, texture and icon stroke.
  - `theme/theme.css` holds the design tokens, Google Fonts with system fallbacks and a zero-specificity base layer for buttons, forms, tables, cards and sections, so the page's own CSS wins.
  - The page's colors and fonts are mapped to theme roles by context, and text in colored or dark areas stays readable. The original values stay as fallbacks, so deleting `theme.css` restores the model's page.
  - Emoji used as icons in feature cards and contact lines become SVG line icons (165 icons from Lucide, ISC license).
  - The topic comes from keywords; only when none or several match does the model answer one short question before its first step.
  - Existing sites, framework projects, single-file requests and requests with their own colors are left alone; follow-up requests in a themed project keep the theme.
  - All theme text colors reach a contrast of at least 7:1 (WCAG AAA).
- Settings › Generation › Web Design: theme mode (by topic, random, fixed with preview, off), base CSS (auto: on below 8B, on, off) and web fonts (off: system fonts only, no external requests).
- Three creation wizards, offered above the message box in an empty session whose folder is empty: "Website Oluştur", "Mini Uygulama" and "Betik". Confirming a wizard puts the generated request into the message box with a small badge; the user reads or edits it and presses send. The request keeps its run options (title, checklist, theme, checks) when it is edited, and pages removed from the text drop out of the checklist.
- Website wizard: a simple mode (site, design, structure, summary) and a detailed mode (site with tagline, audience, language and tone; design; pages and content; contact; features; summary). Pages and sections can be added, renamed, reordered and removed; each section takes the user's own text in a Markdown text box or is written by the agent. Defaults follow the site's topic. The app compiles a request with a file plan, sections with anchor ids and menu links, the user's texts as HTML, contact details and only the features the pages can use, in the site's language. Multi-page sites get one checklist item per page. The draft survives closing the wizard and restarting the app.
- Mini app wizard: 21 single-file web tools in 5 categories, each with its own settings page built from a schema, plus app name, interface language and design theme. Every tool's request carries rules against typical small-model mistakes (no `eval`, `crypto.getRandomValues` for passwords and draws, timers based on timestamps, `textContent` for user text, locale-aware money and dates).
- Script wizard: 13 command-line scripts in 3 categories, in Python (standard library) or Node.js (built-in modules). Every script previews by default and changes files only with `--uygula` / `--apply`, deletes nothing, backs up files before changing them, stays inside the given folder, logs every action and exits with code 1 on errors. Before the first step the app writes a tested safety module (`guvenli_islem` / `safe_actions`) next to the script; the model writes only the script's options and a `plan()` of rename, move and write actions, which the module carries out. "Örnek veriyle dene" makes the agent build a sample folder, run the script on it and check the result. Script runs skip the theme and the web page checks.
- Both catalogs follow the user's language and locale: money and dates come from the browser locale, sample data and name patterns follow the app language, and phone numbers are international.
- Sticky or fixed bars without a `z-index` get one when a theme is applied, and anchor jumps leave room for the bar.

### Changed
- When a model repeats an action, the nudge names the next open checklist item and, if its file does not exist yet, tells the model to create it.
- Files a generated script creates itself (its action log and backup folders) cannot be written by the model. Files the app writes before the first step are listed, not preloaded.
- The message about folders and `write_file` no longer suggests a file name that models then created.
- A successful command that prints the same output again, or runs a third time without a file change, no longer counts as progress. A script task that keeps repeating after its own program ran successfully ends as completed with a note. A script's apply command is not run again on the same folder until a file changes.

### Fixed
- Footers carrying the model's training year ("© 2023") get the current year (ranges keep their start year), and a missing viewport tag is added, with or without a theme.
- Empty `<script>` blocks: the check names the empty block by line and asks for code inside it instead of a new block, a `<script>` holding only a placeholder comment is reported, and a change that only adds copies of existing lines counts as no progress.
- A Python `replace_lines` block indented differently from the lines it replaces is aligned when that removes the error, and re-sending an edit while the file it broke is still broken asks for a complete rewrite.
- An edit that deletes a function or class the file still uses is refused, and files of up to 60 lines with a reported problem are suggested to be rewritten whole.

### Tests
- `test_design_theme.ts`, `test_site_wizard.ts` and `test_tool_wizard.ts` join `npm test`; `test_agent_engine.ts` and `test_agent_reliability.ts` cover themes, wizard and script runs and the loops listed above.
- `scripts/agent-e2e.ts` gains the scenarios `wizard-site`, `wizard-mini` and `wizard-script`.

## [1.6.1] - 2026-09-25

### Fixed
- Requests were split into separate tasks at every line break, semicolon and sentence end. A request is now split into a checklist only where the user wrote an explicit list or joined steps with sequencing words; a part without its own action, or one that points back ("these", "bunları"), stays with the request. The checklist is presented to the model as parts of one task.
- Line edits could take a working page apart. An edit or rewrite that would add errors to a working file, or more errors to a broken one, is no longer applied, and the model sees what its version would have broken. On a broken file only fewer errors count as progress; after three edits without improvement the model gets the whole numbered file and is asked to rewrite it.
- Requests about menu links were misunderstood. When a request names the page's menu links or asks for working links, the task message states which elements are meant, and a new acceptance check keeps the task open until every menu link leads to a section, a page or a JavaScript handler.

### Added
- Benchmark scenarios `nav-links` and `six-products`.
- `test_agent_engine.ts`: tests of the whole agent loop with a scripted model, part of `npm test` and CI.

## [1.6.0] - 2026-09-24

### Fixed
- Generated pages were written JSON-escaped (literal `\n`, `class=\"card\"`) because half-streamed JSON was parsed. Tool calls are now parsed only from complete, valid JSON, and escaped HTML is never accepted as a document.
- Malformed tool calls were written into files as code. They are now repaired (trailing commas, raw newlines) or rejected.
- Follow-up instructions were ignored because rewriting an existing file was always refused. `write_file` now replaces existing files (with diff approval in the Strict profile), and every new task in a session receives the previous request, outcome and changed files.
- Validation told the model "all done" and "criteria not met" at the same time.
- `finish` was blocked for non-web tasks by a fallback contract that required `src/index.js`. Acceptance checks are now created only for web pages.
- Steps stalled because the system prompt changed every step and Ollama read the whole prompt again. The system prompt is now static and the history append-only, so Ollama reuses its cache.
- No `num_ctx` was sent, so every request ran in Ollama's 4096-token default and lost the start of the prompt. Agent and chat now send an explicit context length chosen for the hardware and capped by the model.
- Repetition loops: sampling follows the model's recommended values, thinking models get `think: false` by default, degenerate output is detected while streaming and retried, and repeated actions or runs without progress stop with a message.
- Chat questions about current information trigger a web search, and a model that answers that it has no internet access gets the search results and answers again.
- Edits containing `$&` or `$$` were corrupted, and an edit whose snippet was not found appended text to the end of the file.
- `npm test` never ran on Windows (`spawn npm ENOENT`). npm now runs through `cmd.exe` after its arguments are checked for cmd metacharacters. `node` was added to the allowed programs.
- `write_file` with a folder name created an empty file that blocked the folder. This is refused with guidance, and write failures are reported to the model instead of ending the task.
- The checklist splitting cut requests at commas and inside parentheses.
- Failed or incomplete tasks are shown with an amber card instead of the green completion card.
- Installed and portable Windows copies showed Electron's icon and name. An `afterPack` hook now writes the icon and version information before the installer is built, and the release workflow fails if the exe still carries Electron's metadata.
- Linux packages could not start where Chromium's sandbox is unavailable (Ubuntu 23.10 and later, AppImage and tar.gz copies). The `emir-code` launcher adds `--no-sandbox` only where the sandbox cannot start.
- The Linux setup script showed version 1.3.0 and created shortcuts even when nothing was installed. It now carries the release version, downloads the matching `tar.gz` when needed and stops with an error otherwise.
- Linux docks could not match the window to its icon (`StartupWMClass`), and the in-app shortcut pointed at the temporary AppImage mount.
- A page with an existing but unlinked `script.js` or `style.css` gets the exact tag and line to add.
- The file checks reported valid code as broken (Python 3.12 f-strings reusing their quote, Python 3.14 t-strings, backslash continuations in CRLF files, empty branches with a TODO comment, minified bundles). They now report no errors on the Python standard library and the JS/TS/CSS/HTML/JSON files in `node_modules`.

### Added
- Agent replies are constrained with Ollama `format`: a JSON Schema with one variant per enabled tool.
- An English, compact agent protocol (`AgentProtocol.ts`); `thought` and `summary` follow the user's language.
- File checks after every write (`FileSanity.ts`) for JSON/JSONC, JS/TS/JSX, Java, C/C++/C#, Go, Rust, PHP, Kotlin, Swift, CSS/SCSS, Python, HTML and YAML, plus truncated files and leftover Markdown fences, each reported with the line and a fix hint. Invalid JSON never replaces a valid config, config rewrites that lose keys are merged, and rewrites that would delete most of a file are refused.
- Markdown fences around whole files and double-escaped text are repaired before writing; placeholders such as "rest of the code" are rejected, and sections left as "content goes here" block `finish`.
- In projects with up to 6 files the current file contents are part of the task, up to a quarter of the context window.
- A task whose acceptance checks all pass is completed with a note when the model keeps looping afterwards. New pages must declare the viewport tag, and a `<script>` counts only when it contains JavaScript.
- `replace_lines` and line-numbered feedback: when a check or a failed `edit_file` names a line, the model sees the numbered lines around it and can replace exactly that range.
- Command results: usage text printed by a program started without arguments is reported as expected, tracebacks that point into the project come with the numbered lines, and Python output is read as UTF-8.
- Python block indentation is checked before the program runs.
- Re-applying an identical edit is refused, and changes that leave the same check errors no longer count as progress; after three such changes the model gets the whole numbered file.
- Existing test files cannot be changed unless the user asks for it.
- A status sentence can no longer replace a file's content; messages for the user belong in `finish.summary`.
- The tool schema does not allow empty `write_file` contents.
- The release workflow launches every Linux package on a virtual display.
- Documentation: README with measured model results and installation details, the Turkish user guide `docs/KULLANIM.md`, and updated architecture, security, examples and contributing documents.
- `ModelRuntime.ts` reads parameter size, native context and capabilities from `/api/show`.
- Settings: context length (auto or manual), reasoning for thinking models, the file strategy for web pages; higher output limits (3072, 4096, 8192).
- Tests: `test_agent_reliability.ts`, run by `npm test`, `npm run test:agent` and CI; `scripts/agent-e2e.ts` runs the agent against a local Ollama model.

## [1.5.5] - 2026-09-24

### Fixed
- Edits failed on Windows files because the model's LF line endings did not match the file's CRLF. `applyChunkEdit` now tries, in order: an exact match, a match with normalized line endings, a trimmed match, a line-by-line match that ignores whitespace differences, a full-document replacement when the new text is a complete HTML document, and inserting `<style>` before `</head>` or `<script>` before `</body>`.
- A failed edit was not recorded, so the following `read_file` was blocked as a repeat. Recent edit conflicts no longer block `read_file`, and conflict messages include the current file content.

## [1.5.4] - 2026-09-24

### Added
- When `localhost:11434` cannot be reached at startup or on a connection check, Emir Code starts the local Ollama service and retries. The retry button in the chat starts it as well.

## [1.5.3] - 2026-09-24

### Added
- Hardware profiles for the agent (Auto, Low, Balanced, High, Custom) that set the output limit (512–4096 tokens) from the CPU, RAM and GPU.
- A setting for how files are edited: only the changed parts, or the whole file.
- The agent's system prompt covers all programming languages and applies HTML rules only to web pages.
- Files panel: delete files and folders (with confirmation) and create folders, through the new `workspace:deleteItem` and `workspace:createDirectory` handlers.
- A lightbulb button opens the panel with the model's reasoning and the logs.

### Fixed
- Subtask spinners kept spinning after a task was stopped or finished; stopping a task resets its running subtasks.
- The subtask card is hidden when there is only one item, and the checklist uses muted colors.
- Timeline steps were cut off behind the message box and when the window was resized.

## [1.5.2] - 2026-09-23

### Added
- Small models: a complete HTML document in a reply is written to `index.html` instead of failing; placeholder paths copied from the prompt are normalized; an empty folder leads the model to create a file; checks accept `index.html` and `src/index.html`; a task completes once its checks pass; an edit of a missing file is turned into a create; streaming stops at the end of the action to save time on a CPU.
- A web access button in the Code tab's message box.

### Fixed
- A duplicate profile badge in the agent header.

## [1.5.1] - 2026-09-23

### Added
- `WebIntentDetector.ts`: questions about the weather, exchange rates, news and dates, and explicit search requests, in Turkish and English, trigger a search before the model answers. `extractSearchQuery` turns the question into search terms, and the prompt tells the model to answer from the results.
- Raw action JSON is hidden while it streams, in chat and in the Code tab, and removed from chat answers.
- A web access button in the chat message box. Web access is on by default for chat and the agent.

## [1.5.0] - 2026-09-23

### Added
- Web access with a main switch and separate switches for chat and the agent. When it is off, the web tools are left out of the prompt, and calls that appear anyway are refused by `ToolDispatcher` and `AgentEngine`. Web results are wrapped in `<<<WEB_RESULT_UNTRUSTED>>>` markers. The main process resolves all addresses of a host and refuses private, loopback, link-local, carrier-grade NAT and multicast addresses, checks up to 3 redirects, and aborts running requests when web access is switched off. Searches use DuckDuckGo Lite through a `SearchProvider` interface and return source IDs (`web-001`). A Web access page in Settings.
- `AgentStateMachine` with a table of allowed transitions. `TaskCompiler` turns requests into acceptance checks (`contains_style`, `contains_script`, `html_structure`, …), and `TaskValidator` checks them against the files before a task is completed.
- A compact system prompt for small models (1–3B).

## [1.4.0] - 2026-09-22

### Added
- Linux packages: `.deb`, `.rpm`, AppImage and `.tar.gz`, and a setup script (`build/linux-installer.sh`) with Zenity, KDialog or terminal dialogs that installs the app, creates menu and desktop shortcuts, the `~/.local/bin/emir-code` command and an `uninstall.sh`.
- Linux support in the app: desktop file name, Ollama paths and `systemctl start ollama`, GPU detection with `lspci` and `nvidia-smi`, a minimal environment for commands and stopping child processes on POSIX systems. A Linux desktop integration card in Settings › About.
- The release workflow builds the Windows and Linux packages together and attaches them to the GitHub release.
- Mixed English and Turkish texts were removed from the approval dialogs, the agent workspace, the setup wizard and the model details; `tr` and `en` have the same keys.

## [1.3.0] - 2026-09-22

### Added
- Agent tasks keep their project folder, request, steps, logs and list of applied changes. Reopening the app restores the last project folder; opening an old task restores its folder and timeline. New IPC handler `workspace:setPath`.

### Fixed
- The first chat in the history was selected at startup although no chat was open. "New task" and "New chat" start a clean session, and typing into the message box without a session creates a chat.

### Changed
- Desktop notifications are no longer shown for chat replies. The "reply finished" notification is shown only for agent tasks that ran for at least 20 seconds, and command notifications were removed.

## [1.2.0] - 2026-09-22

### Added
- Requests with several instructions (lists, numbers, or words such as "daha sonra", "ardından", "then", "after that") become a checklist with a status per item.
- An early `finish` or a plain-text reply is refused while checklist items are open, and the model is steered to the next item.
- The system prompt tells the model not to stop before the checklist is complete.

## [1.1.0] - 2026-09-22

### Added
- A new instruction can be sent while the model is working, without stopping the task. The message box offers Stop and "Interrupt & Steer" (Enter), and interventions are shown in the timeline.
- On Windows the taskbar icon flashes when a task finishes or needs an approval or an answer, until the window gets focus; desktop notifications open the window.
- A prerequisites check for Ollama, Node.js (18+) and npm that installs only what is missing, from ollama.com and nodejs.org, and a three-step setup wizard that shows the installed models and downloads a recommended one.

## [1.0.0] - 2026-09-22

### Added
- The agent: a tool loop with local Ollama models such as qwen2.5-coder, deepseek-coder and llama3.
- Project folder checks in the Electron main process (canonical paths, symbolic links resolved) and single-use tokens for file changes.
- Loop guards: a Git check before the first step, tools that cannot run are left out of the schema, a breaker for repeated tool calls, and "did you mean" suggestions for wrong paths (`findClosestPath`).
- A session memory that shortens old context in two levels.
- A muted interface: a security profile selector, a collapsible reasoning block and the same message box in chat and code.
- A Windows NSIS installer with DPI awareness (`ManifestDPIAware true`), so the app stays sharp at 125 %, 150 % and 200 % scaling.
