# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
