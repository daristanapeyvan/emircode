# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-09-26

### Added
- **Design themes for web pages the agent creates**: whatever the model, generated sites looked copied from w3schools — Arial, a `#333` navbar, `#4CAF50` buttons, emoji icons, "© 2023". After the agent finished a new web page, the app now applies one of 24 hand-tuned themes in 8 categories (corporate, luxury, playful, tech, nature & health, food, creative, general). Each theme is a complete design direction — palette, type pairing, shape, depth, button style, texture and icon stroke — not a color swap. The model is never told about it while it works:
  - `theme/theme.css` carries the design tokens, Google Fonts with system fallbacks and a zero-specificity (`:where()`) base layer for buttons, forms, tables, cards and sections, so the page's own CSS always wins,
  - the page's colors and fonts are mapped to theme roles by context: a `#333` navbar becomes the inverse band, the white text inside it `on-inverse`, a `#4CAF50` button the accent, a purple gradient an accent gradient, `Arial`/`Segoe UI`/`Poppins` the theme fonts. Bands re-point the inherited text tokens, so gray text in a colored card or a heading in a dark footer stays readable. Every replacement keeps the original as the fallback (`var(--theme-accent, #4CAF50)`), so deleting `theme.css` restores the model's page,
  - icon emoji in feature cards and contact lines become SVG line icons that follow the theme (165 icons from Lucide, ISC; ratings, form options and code stay untouched),
  - the topic comes from keywords; only when they find none or several does the model answer one short, grammar-constrained question (JSON enum) — before its first step, with the agent's `num_ctx`, so nothing is reloaded or evicted from the prompt cache,
  - existing sites, framework projects, single-file requests and requests with their own colors are left alone (own colors: base layer only; own fonts: fonts untouched); follow-up requests in a themed project keep the theme,
  - in a rendered audit of 72 themed pages (24 themes × 3 typical small-model sites) every text element meets WCAG AAA (7:1); the unthemed originals do not.
- **Settings › Generation › Web Design**: theme mode (by topic / random / fixed with preview / off), base CSS (auto = on below 8B / on / off) and a web fonts switch (off = system fonts only, no external requests).
- **Three creation wizards above the composer**: "Website Oluştur", "Mini Uygulama" and "Betik" appear as suggestion chips in an empty session whose folder is empty (or not chosen yet); an open project never shows them. No wizard starts a run: **Onayla** puts the generated request into the message box with a small badge ("Sihirbazı aç" returns to the wizard, × removes it), the user reads or edits it and presses send. The request keeps its run options (short title, page/step checklist, chosen theme, checks) even when it is edited; pages removed from the text drop out of the checklist, and emptying the box drops the options. A generated request is not spell-checked in the box (it was underlined all over). The wizards use the same controls as Settings (sidebar, rows, switches, buttons).
- **"Website Oluştur" wizard**: a simple mode (site, design, structure, summary) and a detailed mode (site incl. tagline, audience, language and tone; design; pages & content; contact; features; summary):
  - pages can be added, renamed, reordered and removed, sections added/reordered per page; every section takes the user's own text in a smart text box (Markdown toolbar, Ctrl+B / I / K, list continuation on Enter, preview) or is written by the agent,
  - smart defaults follow the site's topic (a cafe gets hero, about, menu, gallery, reviews, contact; switching to several pages moves sections — with their texts — to their own pages),
  - theme cards with miniature previews in the theme's colors and heading font; "no theme" keeps the model's design,
  - the app compiles the request small models work best with: an explicit file plan, every section in order with its anchor id and menu links, the user's texts as ready HTML fragments (models no longer leave `**` in pages), contact data and social links, only the interactive features the pages can use, an image rule and a short quality bar — in Turkish or English, following the site's language,
  - multi-page sites get one checklist item per page; the chosen theme goes to the run directly (no topic question to the model, own-color words in the texts do not switch it off, a theme picked again replaces the previous one of the folder),
  - the summary warns about non-empty folders and very long texts; the draft survives closing the wizard and restarting the app,
  - the timeline shows a short title and the generated request as a collapsible card; the normal composer works exactly as before.
- **"Mini Uygulama" wizard**: 21 single-file web tools in 5 categories (calculators, productivity, tracking, utilities, fun & learning) — calculator, unit/loan/date calculators, bill splitter, Pomodoro, to-do list, notes, countdown, expense/habit tracker, BMI, password generator, color palettes, text tools, random picker, quiz, flashcards, typing test, memory game, snake. Categories on the left, tools as cards (icon, title, description); a tool opens its own settings page with switches, choices, numbers and lists rendered from a schema, plus app name, interface language and design theme. Every tool carries rules against typical small-model mistakes (no `eval` in the calculator, `crypto.getRandomValues` for passwords and draws, timers from timestamps, `textContent` for user text, locale-aware money and dates). The request asks for one `index.html` with inline CSS/JS, is still checked by the web contract, and the theme of the tool's category is applied afterwards.
- **"Betik" wizard**: 13 command line scripts in 3 categories — bulk rename (with a live result on sample names), folder organizer, duplicate finder, ZIP backup, folder size report, CSV merge, CSV ↔ JSON, CSV summary, JSON validator/formatter, bulk find & replace, search in files, email/link/phone extractor, word frequency — in Python (standard library) or Node.js (built-in modules). Every request carries fixed safety rules — preview by default and changes only with `--uygula` / `--apply`, nothing deleted, changed files backed up first, never outside the given folder, every action logged, clear errors with exit code 1, UTF-8 (with BOM) and the system encoding as fallback — and a tested safety module (`guvenli_islem.py` / `safe_actions.py`, or `.js`) that implements them. The app writes the module next to the script before the model's first step (after approval in the strict profile; an existing file is never overwritten); the model writes only the short script from a template shown in the request — the tool's options and `plan()`, which lists rename / move / write actions. The module's `execute()` is the only code that touches files: preview by default, changes only with the flag, never a delete or an overwrite, never outside the folder, a backup before a file's content changes, every action logged. What small models did before: given the rules in prose, a 7B model wrote the core of a rename tool and dropped the extensions, the natural order, the preview and the log; given 170 lines of code inside the request, it spent its whole first reply copying them; given a seeded file to edit, it overwrote the start of `main()`. The request also lists the tool's own flags (the path and the apply flag come ready — the module tolerates them being defined again) and one complete line of the core logic, and the module says so plainly when `plan()` returned nothing. "Örnek veriyle dene" makes the agent build a sample folder, run the script on it and check a stated result (two checklist steps); the rename test lists the exact expected names, and the model is told never to create expected files or logs by hand (it had "fixed" a missing log that way). Flags, file names and sample data follow the app language. Script runs skip the theme and the web page checks (a request that mentions an HTML report is not a web page).
- Both catalogs work worldwide: money and dates come from the browser locale, sample lists and name patterns follow the language, phone numbers are international, nothing assumes one country's taxes or encodings.
- Sticky/fixed bars without `z-index` get one when a theme is applied (a later element with `opacity` painted over the sticky navbar of a model page), and anchor jumps leave room for the bar (`scroll-padding-top`).

### Changed
- **Agent loops**: when a model repeats an action, the nudge now names the next open checklist item and, when that item's file does not exist yet, tells it to create the file with write_file (a 7B model re-read a ready module three times instead of writing the script).
- **Script runs**: files only the generated program may create (its action log and backup folders) cannot be written by the model; it is sent back to the script (a 7B model "fixed" a missing log by writing it itself). Files the app writes before the first step are listed, not preloaded.
- The "folders cannot be created with write_file" message no longer suggests `<folder>/index.js` (a model created that page).
- **Repeated commands**: a successful command that prints exactly the same thing again, or that is run a third time without any file change by the model, no longer counts as progress; the model is told to finish when the result is what the task expects (a 7B model re-applied a finished rename script 30 times, renaming its test files again on every run). If it still does not finish, a task without acceptance checks (a script) ends as completed, with a note to check the result, instead of "loop detected" when a file the model wrote ran with exit code 0 after its last change and no command failed since; a model that wrote nothing, only ran other commands, or changed the program after its last good run is still stopped. A script that changes files is not applied twice: the same command with its apply flag (`--uygula` / `--apply`) is not run again until a file changes, nor is its preview of the folder it already changed (that preview proposes renaming the renamed files, which a model took for "not done yet" and started over in ornek_veri2, ornek_veri3…); the model gets the result of the applied run instead (in the app, a 7B model had applied its rename script to the sample folder five times, each time calling it a preview).

### Fixed
- **Stale copyright years**: models write the year of their training data into footers ("© 2023", "2022-2023 ©"). Pages the agent writes now carry the current year (ranges keep their start year); a missing viewport meta tag is added. Both run whether or not a theme is used.
- **Empty `<script>` blocks**: in the app, qwen2.5-coder:7b wrote a Pomodoro page whose `<script>` held only "// JavaScript kodu buraya gelecek"; the check answered "add a `<script>` block before `</body>`", so the model appended another empty block on every step — 16 of them in 35 steps. The check now names the empty block by line and says to write the code inside it, add no new block and remove the extra empty ones; the file check reports a `<script>` holding only a placeholder comment; and a change that only adds copies of lines the file already had counts as no progress (three in a row reach the loop brake).
- **Stray indentation in Python edits**: in the app, qwen2.5-coder:7b filled a script's `add_options()` with the `def` indented by four spaces (IndentationError) and then re-sent exactly the same edit three times. A `replace_lines` block indented differently from the lines it replaces is now aligned to them when that removes the error, and re-sending an edit while the file it left broken is still broken shows the whole file and asks for a complete rewrite instead of another line patch. The script template's option comment now leads with "Eklenecek seçenekler" / "Options to be added", so an `add_options()` left empty is reported in both languages.
- **Edits that delete a function still in use**: in a second app run the model filled `add_options()` over a line range that also held `def plan(...)`; the file stayed valid Python but `run_tool(..., plan)` had nothing left to call, and the model kept patching. An edit that deletes a function or class the file still uses is now refused with the line to stop before, and a file of up to 60 lines with a reported problem is suggested to be rewritten whole rather than patched line by line.

### Tests
- `test_design_theme.ts` (89 checks: theme contrast, color/font mapping, page fixes, when the theme turns on, topic detection, end-of-run changes), `test_site_wizard.ts` (65 checks: Markdown → HTML, smart text box edits, files/anchors, topic defaults, request compiler, wizard store) and `test_tool_wizard.ts` (44 checks: parameter schema, both catalogs, every tool's request in Turkish and English, safety rules, rename result, composer hand-over, wizard store, and the scripts' safety module and template run in Python and Node) join `npm test`; `test_agent_engine.ts` covers themes, wizard runs, seed files, script outputs, repeated commands, how a script run that keeps re-running ends, and the empty-`<script>`, stray-indentation, deleted-function and re-applied-script loops from the app, with a scripted model (52 checks); `test_agent_reliability.ts` adds the empty-script, copied-lines and indentation checks (225 checks).
- `scripts/agent-e2e.ts` gains `wizard-site`, `wizard-mini` and `wizard-script`: the wizards' requests and run options with a real local model; the generated rename script is run independently (preview must change nothing, `--uygula` must rename, contents and log kept).

## [1.6.1] - 2026-09-25

### Fixed
- **Requests split into broken "tasks"**: the goal decomposition cut a request at every line break, semicolon, sentence end and imperative verb, so "Home About Services Contact / Get these working. You can change the page content using JavaScript." became two tasks, the first of them just the menu names (phi4:14b in-app report). A request is now split into a checklist only where the user wrote an explicit list (numbered or bulleted lines, or "1) … 2) …") or joined steps with sequencing words ("…, sonra …", "ve en son …", "then"); a part without an action or one that points back ("these", "bunları") keeps the request whole. The checklist is presented to the model as parts of one task.
- **Edits that took a working page apart**: a qwen2.5-coder run replaced 9-line windows with `replace_lines`, lost the `<script>` line, and then "fixed" each new check error with another window edit — 30 steps later the page was a pile of scattered `<style>`/`<script>` tags. Now:
  - an edit or rewrite that would introduce errors into a working file is not applied; the model sees what its version would have broken (numbered lines of its own version) and how `replace_lines` must be used,
  - an edit may not add errors to an already broken file,
  - on a broken file only fewer errors counts as progress, so swapping one error for another reaches the no-progress stop; after three such edits the model gets the whole numbered file and is told to rewrite it in one go,
  - line-level hints say which line stays unchanged, and the `replace_lines` description says that every line of the range is replaced.

- **Menu requests misunderstood**: for "Home About Services Contact — get these working" qwen2.5-coder built a pop-up for another button and finished. When a request names the page's menu links (or asks for working links / navbar redirects), the task message now says which elements are meant (`REFERENCED ELEMENTS: "Home", "About", … are the menu links of index.html, lines 24-27`) and a new acceptance check keeps the task open until every menu link leads to an existing section, an existing page or a JavaScript handler; dead links are listed with their line numbers.

### Added
- Agent benchmark scenarios `nav-links` and `six-products`, replaying the two reported requests and checking that the page stays valid with a single `<style>` and `<script>` block.
- `test_agent_engine.ts`: integration tests of the whole agent loop with a scripted model (harmful edit refused, menu request grounded and verified, explicit list becomes a checklist), part of `npm test` and CI.
- Tests: `test_agent_reliability.ts` (220 checks), `test_agent_engine.ts` (12 checks).

## [1.6.0] - 2026-09-24

### Fixed
- **Corrupted web pages ("düz HTML", styles never applied)**: the early stream cut-off parsed half-streamed JSON and its raw-HTML fallback wrote the JSON-escaped string to disk (literal `\n`, `class=\"card\"`), so CSS classes, charset and scripts silently broke on every generated page. Tool calls are now parsed only from complete, valid JSON; escaped HTML is never accepted as a document.
- **Malformed tool calls written into files**: a JSON action with a small syntax error was treated as "raw code" and written into `index.html` / `src/index.js` / `main.py`. Malformed actions are now repaired (trailing commas, raw newlines) or rejected, never written.
- **Follow-up instructions ignored ("stil ekle", "devam")**: rewriting an existing file was always refused by the main process (`allowOverwrite` never sent), and a re-created file could end the task as "completed" while discarding the new content. `write_file` now replaces existing files (with diff approval in strict mode) and every new task in a session receives the previous request, outcome and changed files.
- **Contradictory validation messages**: `evaluateAndAdvanceSubtask` was missing its `else` branch, telling the model "all done, finish" and "criteria not met, edit again" at the same time, and nothing when validation actually failed.
- **`finish` blocked for non-web tasks**: the fallback contract required `src/index.js` for every bug fix or Python task. Contracts are now only generated for web pages, where they can be verified.
- **Constant stalls between steps**: the session ledger was appended to the system prompt and history was rewritten every step, so Ollama re-evaluated the whole prompt each time (~15 tokens/s on CPU = minutes per step). The system prompt is now static and history append-only, keeping the KV cache warm (a cached step re-evaluates ~1 s instead of ~90 s).
- **Context silently truncated**: no `num_ctx` was ever sent, so every request ran in Ollama's 4096-token default window and dropped the start of the (Turkish, ~3k token) prompt. Agent and chat now share an explicit, hardware-aware context window capped by the model limit (no model reload when switching modes).
- **Repetition loops**: near-greedy sampling (temperature 0.1) plus hidden qwen3 reasoning made models loop. Sampling follows model recommendations, `think:false` is sent to thinking models by default, degenerate output is detected mid-stream and retried with different sampling, and repeated actions / no-progress runs are stopped with a clear message.
- **Web search in chat**: questions such as "şebnem ferah kimdir" now trigger a search, and when a model answers "erişimim yok / internette arayın" while web access is on, the app performs the search and answers again.
- `String.replace` special patterns (`$&`, `$$`) corrupted edits containing dollar signs; edits no longer append text to the end of a file when the snippet is not found.
- **`npm test` never ran on Windows**: the command runner spawned `npm` without a shell, which always failed with `spawn npm ENOENT` (npm is a `.cmd` shim). npm now runs through `cmd.exe` as a single command string after rejecting cmd metacharacters. `node` joins the allowed binaries (same approval rules as `python`).
- Small models "creating a folder" with `write_file` produced an empty file that blocked every file inside it; this is now rejected with guidance, and write failures are reported to the model instead of aborting the task.
- Goal decomposition split requests at "ürün," / "için," and inside parentheses; only explicit sequencing words and imperative verbs split a request into checklist items now.
- Failed or incomplete tasks are shown with an amber warning card instead of the green "completed" card.
- **Electron icon in the Windows taskbar**: the icon and version information were written into `EmirCode.exe` only after the installer had been built, so installed and portable copies kept Electron's icon (taskbar, shortcuts, Explorer) and "Electron" as product name. An electron-builder `afterPack` hook now embeds them before the installer and portable exe are created; the release workflow fails if the exe still carries Electron's metadata.
- **Linux packages that could not start**: on Ubuntu 23.10+ (AppArmor restricts user namespaces) and for AppImage/tar.gz copies, Chromium's sandbox cannot start and Electron exits. A generated `emir-code` launcher keeps the sandbox where it works and adds `--no-sandbox` only where it cannot.
- **Linux setup script**: it showed version 1.3.0, and when downloaded on its own it installed nothing but still created shortcuts. It now carries the release version, downloads the matching `tar.gz` when needed and stops with a clear error otherwise.
- **Linux dock icon**: desktop entries used `StartupWMClass=emir-code`, which does not match the window class Electron sets ("Emir Code"), so docks could not match the window to its icon. The in-app "create shortcuts" action no longer points at the temporary AppImage mount folder.
- **Validator messages**: a page with an existing but unlinked `script.js`/`style.css` now gets the exact tag and line to add; the E2E benchmark only counts CSS/JS a page actually loads.
- **False positives in the file checks**: Python 3.12+ f-strings that reuse their quote inside `{…}` (`f'{todo['task']}'`), Python 3.14 t-strings, backslash line continuations in CRLF files, empty `catch`/`else` branches with a TODO comment and minified one-line bundles were reported as broken code, which made the model "fix" valid code. The checks now report no errors on the Python standard library and the JS/TS/CSS/HTML/JSON files in `node_modules` (about 12,000 files).

### Added
- **Structured output**: agent replies are constrained with Ollama `format` (JSON Schema, one variant per enabled tool with its own required fields), so every reply is a complete, valid action.
- **English, compact agent protocol** (`AgentProtocol.ts`) without copyable placeholder examples; `thought`/`summary` follow the user's language.
- **Automatic file checks for every file type** (`FileSanity.ts`): JSON/JSONC, JS/TS/JSX, Java, C/C++/C#, Go, Rust, PHP, Kotlin, Swift, CSS/SCSS, Python (brackets, strings, tab/space mix), HTML (unclosed sections, duplicated documents, inline script/style), YAML tabs, truncated files and leftover markdown fences, each reported with the offending line and a concrete fix hint. Invalid JSON is never written over a valid config, lossy config rewrites are merged so existing keys (e.g. `scripts.test`) survive, and rewrites that would delete most of a file (or turn a page into a fragment) are refused with `edit_file` guidance.
- **Content repair**: markdown fences around whole files and double-escaped text are fixed before writing; lazy placeholders ("rest of the code", "kodun geri kalanı") are rejected; sections or function bodies left empty with "content goes here" comments, and visible placeholder text such as "SSS içeriği buraya gelecek", block `finish` until real content is written.
- **Small-project context**: for projects with up to 6 files the current file contents are part of the task (bounded to 25 % of the window), so follow-ups modify the real page instead of rewriting it blindly; files corrupted by older versions are shown decoded for repair.
- **Verified completion**: if the model wanders off after the work is done (loops, invented tooling), a task whose acceptance checks all pass is completed with a note instead of being reported as failed. New pages must also declare the viewport meta tag, and a `<script>` only counts when it contains JavaScript (not HTML markup).
- **`replace_lines` tool and line-numbered feedback**: when a check or a failed `edit_file` names a line, the model sees the numbered lines around it and can replace that exact line range, so small models no longer get stuck re-typing text they cannot copy exactly (e.g. a Python string broken across lines). Repeated or no-op steps are answered with the checks that are still failing.
- **Command results the model can act on**: a program started without arguments that prints its usage text is reported as correct behaviour instead of an error (qwen2.5-coder kept "fixing" a working CLI until it broke it), tracebacks and stack traces that point into the project include the numbered lines at that location, and Python output is decoded as UTF-8 (Turkish text arrived as "Kullan�m").
- **Python block indentation check**: a header ending with `:` without an indented block, an unexpected indent and a dedent to an unknown level are reported with line numbers before the program is run.
- **Edit loops**: re-applying an edit identical to one already applied is refused (gemma2:2b deleted one CSS line per step by repeating the same `replace_lines`), and changes that leave the same check errors in place no longer count as progress; after three such changes the model gets the whole numbered file. HTML check messages name the exact lines (where CSS outside `<style>` starts, where to close a block, where `</body>` belongs).
- **Tests rewritten to pass**: when qwen2.5-coder could not fix a bug, it changed the failing assertion in `test/price.test.js` and reported "all tests passed". Existing test files can no longer be edited or rewritten unless the user asks for test changes; the model is told to fix the implementation instead.
- **Status messages written into files**: a small model "informed the user" by overwriting the shopping list it had just written with "Alışveriş listesi hazırlandı." (in-app test). A short completion sentence can no longer replace a file's content, and the protocol states that messages for the user belong in `finish.summary`.
- **Empty file contents**: the tool schema no longer allows an empty `write_file` content (gemma2:2b wrote a 0-byte `index.html`); such a reply is re-sampled once and otherwise refused with a clear message.
- **Linux smoke test in the release workflow**: every release starts the AppImage, the installed `.deb`, the `.rpm` contents, the extracted `tar.gz` and a setup-script installation on a virtual display and checks that each one opens its window.
- **Documentation**: README rewritten with a "What can you do with Emir Code?" section, measured model recommendations, accurate installation file names and troubleshooting; new Turkish user guide `docs/KULLANIM.md`; ARCHITECTURE, security documents, examples and contributing guide updated to match the code (web access default, command allowlist, token lifetime, checklist handling, packaging pipeline).
- **Language**: Turkish requests get Turkish `thought`/`summary` text.
- **Model runtime profile** (`ModelRuntime.ts`): reads parameter size, native context and capabilities from `/api/show`; small-model detection no longer flags 12b/32b/72b models.
- **Settings**: context length (auto/manual), agent reasoning toggle for thinking models, web synthesis strategy; output token presets raised (3072 / 4096 / 8192).
- **Tests**: `test_agent_reliability.ts` (195 checks) plus `npm test` / `npm run test:agent`, wired into CI; `scripts/agent-e2e.ts` benchmarks the agent end-to-end against a local Ollama model (web page, follow-up, repair, JS bug fix + `npm test`, Python CLI, JSON config).

## [1.5.5] - 2026-09-24

### Fixed
- **CRLF & Multi-Tier Chunk Replacement Engine (Windows Diff Çakışması ve Döngü Koruması Düzeltmesi)**:
  - Fixed Windows CRLF (`\r\n`) vs LLM LF (`\n`) newline mismatch in `propose_edit` where character-for-character chunk comparisons failed 100% of the time on Windows files.
  - Implemented 6-tier resilient chunk replacement engine (`applyChunkEdit`):
    1. Exact verbatim match.
    2. CRLF/LF line-ending normalization.
    3. Trimmed match (ignoring extra leading/trailing blank lines).
    4. Line-by-line whitespace-tolerant matching (resolving indentation differences between tabs and spaces).
    5. Full document replacement (if `new_chunk` contains complete `<!DOCTYPE html>` or `<html>...</html>`).
    6. Smart HTML tag injection (injecting `<style>` before `</head>` and `<script>` before `</body>`).
  - Fixed `actionHistory` bug where failed diff conflicts didn't record their status, leaving `read_file` as the last action and triggering false "Döngü Engellendi: zaten az önce okundu" blocks.
  - Exempted recent diff conflicts from `read_file` loop protection so the model can inspect the current file without being blocked.
  - Inlined current file content directly in diff conflict error responses (`<<<FILE_CONTENT>>>`) so models don't waste extra steps on redundant `read_file` calls.

## [1.5.4] - 2026-09-24

### Added
- **Automatic Local Ollama Health & Service Auto-Recovery (Otomatik Ollama Servis Başlatma ve İyileştirme)**:
  - On application startup or manual `checkConnection`, if `localhost:11434` is unreachable, Emir Code automatically triggers the local Ollama background service (`startOllamaService`) and retries with backoff instead of dropping to a disconnected state.
  - Added an active loading indicator and auto-start invocation to the "Yeniden Dene" banner button in `ChatContainer`.

## [1.5.3] - 2026-09-24

### Added
- **Hardware & Model-Agnostic Agent Optimization Architecture (Donanım ve Modelden Bağımsız Kodlama Mimarisi)**:
  - Added configurable hardware optimization profiles (`Auto`, `Low`, `Balanced`, `High`, `Custom`) with dynamic output token scaling (512 - 4096) based on host system hardware (CPU cores, RAM, GPU/VRAM).
  - Configurable code modification strategy (`smart_injection` vs `full_overwrite`).
  - Generalized agent system prompts to support all programming languages (Python, Go, Node.js, C++, Rust, etc.) while applying HTML standards only when building web interfaces.
- **Non-Intrusive Project Explorer Management (Proje Gezgininde Dosya Silme ve Klasör Oluşturma)**:
  - Zero permanent visual clutter: Hover-revealed delete icon (`Trash2`) on files and folders with confirmation dialog.
  - Hover-revealed folder creation button (`FolderPlus`) on directories and dedicated root button in the Project Explorer header.
  - Inline folder name input with keyboard shortcuts (`Enter` to confirm, `Esc` to cancel).
  - Secure symlink-safe IPC handlers in Electron Main process (`workspace:createDirectory`, `workspace:deleteItem`).
- **Reasoning Dump Toggle Lightbulb Icon (Ampul Simgesi)**:
  - Replaced the right-panel toggle icon with `<Lightbulb size={13} strokeWidth={1.5} />` (amber idea highlight) for intuitive access to model internal reasoning traces and execution logs.

### Fixed
- **Subtask Spinner Infinite Loop & Ghost Spinning Fix (Durdurulunca veya Boştayken Dönen Spinner Düzeltmesi)**:
  - Fixed issue where subtask loaders continued to spin indefinitely when a task was stopped, idle, or completed.
  - Conditioned spinner rendering strictly on `task.status === 'in_progress' && isBusy`, showing a clear paused indicator (`⏸`) when execution is halted.
  - Synchronized `stopGoal`, `onStatusChange` (idle, error, finished), and `AgentEngine` abort/error paths to cleanly reset in-progress subtasks to `pending`.
- **Subtask UI Redesign & "AI Slop" Elimination (Minimalist Alt Görev Listesi)**:
  - Completely hides subtask card when there is only a single task (`subtasks.length <= 1`), eliminating loud progress bars, repetitive "AKTİF ODAK" badges, and cyan visual clutter.
  - Redesigned multi-subtask checklists to a sleek, minimalist Linear/Cursor style with muted zinc tones.
- **Chat Timeline Cut-Off / Clipping Fix (Zaman Çizelgesi Taşma ve Kırpılma Çözümü)**:
  - Replaced rigid `h-full` constraints with `min-h-full flex flex-col justify-start` inside scrollable view.
  - Added bottom padding (`pb-20 scroll-smooth`) and auto-scroll anchor (`timelineEndRef`) ensuring timeline steps never get cut off or obscured behind the composer input bar.
  - Added `min-w-0` to tool step cards preventing horizontal clipping during window resizing.

## [1.5.2] - 2026-09-23

### Added
- **Gemma 2B & SLM End-to-End Website Generation Support (Küçük Dil Modelleri Optimizasyonu)**:
  - Direct HTML document extraction (`<!DOCTYPE html>...</html>` or `<html>...</html>`) automatically falls back to `propose_create` targeting `index.html`, eliminating JSON parsing failures and chat stops for SLMs.
  - Normalized prompt schema placeholders (`"hedef_klasor"`, `"hedef_dizin"`, `"."`, `"./"` to root; `"hedef_dosya.js"` to active contract target) to prevent models literally copying placeholder strings.
  - Empty directory observation enhancement: guides models to immediately call `propose_create` instead of misdirecting them to `read_file`.
  - Flexible contract target paths: TaskCompiler and TaskValidator now support both root (`index.html`) and nested (`src/index.html`) files.
  - `propose_create` anti-loop guard with automatic criteria re-verification: auto-completes tasks once contract evidence passes, preventing unnecessary re-generation cycles.
  - Non-existent file guard for `propose_edit`: redirects failed edits on new files to `propose_create`.
  - Early stream cutoff: aborted inference on closing JSON brackets (`}`), code fences, or `</html>`, dramatically reducing inference time on CPU.
- **Web Access Toggle in Agent Composer (Kod Ajanında Ağ Erişimi Butonu)**:
  - Added the `<Globe>` network toggle button directly in the Agent Workspace composer bar next to the workspace picker, matching the Chat Composer UX.
  - Controls `settings.webAccess.codingEnabled` with instant visual indicators and tool schema exclusion when disabled.

### Fixed
- **Duplicate Sandbox Badge in Agent Workspace (Mükerrer Sandbox İfadesinin Kaldırılması)**:
  - Removed redundant autonomous profile badge from the Agent Workspace header to avoid UI duplication with the security profile selector.

## [1.5.1] - 2026-09-23

### Added
- **Multi-Lingual Proactive Web Search Auto-Detection (`WebIntentDetector.ts`)**:
  - Dual-layer hybrid architecture: Client-side pre-flight search auto-triggers on real-time queries (weather, currency rates, news, dates/temporal) with zero token delay and zero model hesitation.
  - Multi-lingual coverage for Turkish, English, and international tech/finance terms (temporal `2024-2029`, weather, news, finance/crypto, and explicit search requests).
  - Search query extractor (`extractSearchQuery`) cleans conversational filler and delivers crisp search terms to DuckDuckGo/SearchProvider.
  - Grounded context injection with strict anti-excuse and anti-JSON directives, eliminating model hallucinations ("internetim yok", "bağlantı hatası").
- **Complete Raw JSON Concealment (Sohbet ve Kod Ajanında Çıplak JSON'ın Gizlenmesi)**:
  - Streaming token suppression (`onToken`) masks action JSON chunks live, showing clean progress indicators (`🔍 Web'de aranıyor...`).
  - Markdown content sanitizer (`cleanChatContent`) strips action JSON blocks and conversational prefaces like "JSON yazabilirim:".
  - Code agent workspace live stream parser (`parseAgentStream`) replaces raw JSON brackets with animated Action Preparation Cards (`⚡ Kod Düzenleme Hazırlanıyor → src/...`).
  - Thought steps and final answer cards are filtered with `cleanThoughtContent` and `cleanChatContent` to prevent syntax leaks.
- **Instant 1-Click Web Access Toggle in Chat Composer**:
  - Added a sleek `Globe` icon button in `Composer.tsx` right next to the attachment icon, showing active status (`🌐 Web Açık`) and allowing 1-click toggling.
  - Updated default settings (`DEFAULT_SETTINGS.webAccess`) to `enabled: true, chatEnabled: true, codingEnabled: true` for out-of-the-box search readiness.

## [1.5.0] - 2026-09-23

### Added
- **Configurable Zero-Trust Web Access & Search Subsystem (Kullanıcı Kontrollü Sıfır-Güven Web Erişim & Arama Sistemi)**:
  - Global `Web Access: ON / OFF` master toggle with granular child controls (`Chat Search: ON / OFF`, `Coding Agent Search: ON / OFF`).
  - Strict Schema Exclusion: When Web Access is OFF, web tool schemas (`web_search`, `fetch_url`) are completely excised from prompt schemas to prevent hallucinated calls.
  - Dual-Layer Runtime Enforcement: Unauthorized tool invocations are blocked immediately at both ToolDispatcher and AgentEngine boundaries with system notices.
  - Zero-Trust Untrusted Boundary Delimiters (`<<<WEB_RESULT_UNTRUSTED>>> ... <<<END_WEB_RESULT_UNTRUSTED>>>`): Injected search snippets and fetched pages are strictly quarantined to prevent prompt injection and indirect jailbreaks.
  - Anti-DNS-Rebinding & Multi-IP SSRF Shield: Resolves all A and AAAA DNS records (`{ all: true }`); blocks IPv4/IPv6 private ranges, loopbacks, link-local, carrier-grade NAT, multicast; validates redirect targets step-by-step up to 3 hops with single network authority in Electron Main process.
  - Instant In-Flight Abort: Immediately cancels running searches/fetches via `AbortController` and `web:abortAll` IPC if the user switches Web Access OFF mid-operation.
  - Pluggable `SearchProvider` Interface: Clean provider abstraction with default `DuckDuckGoProvider` (Lite POST, no API key required) outputting structured source IDs (`web-001`, `web-002`) for precise document grounding.
  - Modern UI & Settings: Lucide line icons, dedicated Web Access tab in SettingsModal, and non-intrusive collapsible activity badges in Chat and Timeline.
- **Evidence-Based Stateful Agent Architecture (Kanıta Dayalı Durumsal Ajan Mimarisi)**:
  - Strict `AgentStateMachine`: Formal state machine (`PENDING -> PLANNING -> EXECUTING -> VALIDATING -> COMPLETED -> DONE`) preventing illegal transitions and execution loops.
  - `TaskCompiler` & `Compiler Guard`: Compiles overarching user goals into typed `TaskContract` specifications with enforceable acceptance criteria (`contains_style`, `contains_script`, `html_structure`, etc.) and consolidated subtasks.
  - Evidence-Based `TaskValidator`: Prevents false completion reports by validating disk artifacts against tangible evidence criteria before marking tasks completed.
  - Coder Model Strict Fallback Hierarchy: Explicit file path resolution with contract mapping, eliminating blind hallucinated file path guessing.
  - SLM (Small Language Model) Optimization: Compact system prompts tailored for efficient 1B-3B parameter models (`qwen2.5-coder:1.5b`, `deepseek-coder:1.3b`, `codegemma:2b`, etc.).

## [1.4.0] - 2026-09-22

### Added
- **Full Linux Desktop Support & Multi-Distro Packaging (Tam Teşekküllü Linux Desteği)**:
  - Added official Linux targets: Debian/Ubuntu (`.deb`), RedHat/Fedora (`.rpm`), universal (`AppImage`), and portable (`.tar.gz`).
  - Created standalone graphical setup wizard (`build/linux-installer.sh`) supporting Zenity (GNOME), KDialog (KDE), and interactive CLI fallback.
  - Setup wizard handles installation directory picker, `.desktop` shortcut creation in `~/.local/share/applications`, desktop launcher placement, terminal command symlink (`~/.local/bin/emir-code`), and generates a dedicated uninstaller (`uninstall.sh`).
  - Native Linux integration: `app.setDesktopFileName('emir-code.desktop')`, Linux Ollama search paths (`/usr/local/bin/ollama`, `/usr/bin/ollama`), systemd service control (`systemctl start ollama`), cross-platform GPU detection (`lspci`, `nvidia-smi`), POSIX `STRICT_ENV` sandbox containment (`HOME`, `SHELL`, `LANG`, `XDG_DATA_HOME`), and POSIX process tree termination.
  - Added Linux Desktop Integration card in Settings -> About for 1-click shortcut re-integration.
- **GitHub Actions Dual-Platform Release Matrix (Otomatik Çift Platform Release)**:
  - Release workflow (`.github/workflows/release.yml`) builds Windows (`Setup.exe`, portable `.exe`) and Linux (`.deb`, `.rpm`, `.AppImage`, `.tar.gz`, setup script) simultaneously and attaches all binaries to GitHub Releases upon tag push.
- **Complete Localization Parity (Eksiksiz Çeviri Uyumu)**:
  - Eliminated all mixed English/Turkish strings across the UI: Changeset Modal, Command Approval Modal, Delete Approval Modal, Agent Workspace Timeline & Reasoning Bar, Onboarding Wizard, and Model Details Modal.
  - Full structural parity between Turkish (`tr`) and English (`en`) localization dictionaries.

## [1.3.0] - 2026-09-22

### Added
- **Emir Code Workspace & Session Persistence (Oturum ve Proje Klasörü Kalıcılığı)**:
  - Agent conversations (`mode: 'agent'`) now fully persist their workspace folder (`workspaceRoot`), goal, multi-step execution timeline (`agentSteps`), system logs (`executionLogs`), and rollback transaction history (`appliedTransactions`).
  - Closing and reopening the app seamlessly restores the previously opened project directory without requiring re-selection.
  - Selecting any historical coding agent session dynamically restores its project folder, refreshes the file explorer tree, and renders its complete historical timeline.
  - Added native `workspace:setPath` IPC handler with path existence and directory verification.

### Fixed
- **Startup Chat Highlighting Bug (Açılışta Sahte Sohbet Vurgulaması Giderildi)**:
  - Fixed issue where the first conversation in history was automatically selected on application launch (`activeChatId: null`), creating a false impression that a chat was open while the main viewport was clean.
  - Clicking "Yeni Görev" or "Yeni Sohbet" cleanly resets the active session without pre-highlighting other sessions.
  - Automatic on-demand chat creation when typing a prompt in composer without an active session.

### Changed
- **Long-Running Notification Throttling (Uzun Süreli Görevler İçin Akıllı Bildirim)**:
  - Removed noisy desktop toast notifications from regular chat interactions.
  - "Emir Code - Yanıt Tamamlandı" native desktop notification is now strictly limited to long-running Emir Code sessions (task execution duration >= 20 seconds).
  - Silenced repetitive command execution desktop toasts to prevent toast notification spam.

## [1.2.0] - 2026-09-22

### Added
- **Multi-Instruction Task Decomposition & Checklist Engine (Çoklu Talimat Ayrıştırma & Kontrol Listesi)**:
  - Automatically parses compound user prompts containing multiple instructions, bullet points, numbers, or sequential phrases (`daha sonra`, `ardından`, `ve son olarak`, `then`, `after that`).
  - Maintains a structured task checklist (`TaskChecklistItem[]`) directly in the Session Memory Ledger.
  - Distinct status tracking: `✅ [TAMAMLANDI]`, `🔄 [ŞU ANKİ AKTİF ODAK]`, and `⏳ [BEKLEMEDE]`.
- **Anti-Premature Termination Guard (Erken Kapanış Bariyeri)**:
  - Eliminates "premature stopping" where models focus on one instruction and immediately terminate the task.
  - Automatically intercepts early `finish` action calls or premature plain-text responses when pending subtasks remain.
  - Advances subtask state sequentially and dynamically injects next-task steering prompts into the conversation.
  - Replaced misleading tool observation advice urging premature task completion with subtask-aware progress feedback.
- **Multi-Task Prompting Directive**:
  - Enhanced system prompt with strict rules forbidding early termination until all subtasks in the checklist are completely satisfied.

## [1.1.0] - 2026-09-22

### Added
- **Live Model Interruption & Steering (Araya Girip Yönlendirme)**:
  - Users can interrupt active local model generation or agent reasoning steps mid-flight without losing state or aborting the task.
  - Real-time steering prompt injection into session memory ledger and conversation context.
  - Dual-action composer: Stop (full abort) vs. Amber-accented "Interrupt & Steer" button (with `Enter` shortcut).
  - High-visibility `user_steering` timeline cards documenting live interventions.
- **Windows Taskbar Yellow Blinking & Desktop Notifications**:
  - Automatic `flashFrame(true)` causing Windows taskbar icon to flash orange/yellow upon code/command completion or when clarification/approvals are requested.
  - Immediate reset of flashing upon window focus.
  - Native toast notifications linking directly back to focused window.
- **Automated Prerequisites Scanner & Interactive Model Onboarding Wizard**:
  - Automated detection of Ollama, Node.js (v18+), and npm with version verification.
  - Idempotent installer: skips downloading/installing components already present on the system.
  - Transparent external download disclaimer banner citing official download sources (`ollama.com`, `nodejs.org`, `registry.ollama.ai`).
  - 3-step interactive onboarding wizard displaying all installed local models with 1-click activation, alongside real-time download progress for curated coding models.

## [1.0.0] - 2026-09-22

### Added
- **Autonomous Agent Engine**: Dynamic tool loop pairing locally with Ollama models (`qwen2.5-coder`, `deepseek-coder`, `llama3`).
- **Cryptographic Realpath Jail**: Enforces OS-level filesystem isolation in the Electron Main process with single-use 256-bit mutation tokens.
- **Anti-Loop Guard & Milestone Progression**:
  - Pre-flight environment inspection (Git availability detection & file tree indexing).
  - Dynamic tool schema masking to prevent models from calling non-existent OS binaries.
  - Deterministic 4-step cycle breaker to prevent repeated tool ping-pong.
  - Fuzzy did-you-mean path matching (`findClosestPath`).
- **Sliding-Window Memory Ledger**: Two-tier context compression keeping local LLMs focused without token exhaustion.
- **AAA Minimalist UI Architecture**:
  - Linear/Cursor-inspired neutral palette and subdued micro-interactions.
  - Unified security profile selector with embedded Realpath jail status tooltip.
  - Collapsible monokrom reasoning block with single micro-spinner.
  - Consistent message composer between Chat and Code workspaces.
- **Native High-DPI Windows Installer**: NSIS configuration with `ManifestDPIAware true` eliminating blurriness on 125%, 150%, and 200% display scaling.
