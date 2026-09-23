# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
