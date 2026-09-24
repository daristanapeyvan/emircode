# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
