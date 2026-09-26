# Emir Code

<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Emir Code icon" />

A desktop app for Windows and Linux that runs AI models on your own computer through [Ollama](https://ollama.com): chat with a model, or let a coding agent work in a project folder while you review every change.

[![Platform](https://img.shields.io/badge/Platform-Windows%20x64%20%7C%20Linux%20x64-blue.svg)](https://github.com/daristanapeyvan/emircode/releases)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Türkçe kullanım kılavuzu: [docs/KULLANIM.md](./docs/KULLANIM.md)

</div>

---

## What Emir Code does

The app has two modes, switched at the top of the sidebar: **Chat** for questions and **Code** for an agent that works inside a project folder. The interface is available in English and Turkish; you can write requests in any language your model understands.

### Chat
- Ask coding questions; code blocks have syntax highlighting and a copy button.
- Attach a text or code file, or an image, and ask about it. Images need a model that accepts image input.
- With **Web** switched on (the globe button in the message box), questions about current information (people, news, prices, weather) are searched on DuckDuckGo first and answered from the results; the message shows what was searched. If a model still replies that it cannot go online, the app runs the search and generates the answer again.
- Settings › Generation holds the sampling of the open chat, with the presets Balanced, Precise, Creative and Coding. The **System instructions** button in the message box offers General assistant, Senior developer and Very concise, or your own text.

### Code (the agent)
Start a **New Project** in the sidebar or open a folder you already have, describe what you want, and follow the agent as it reads files, writes code and runs tests. The sidebar lists your tasks by project folder; the **+** next to a project starts a new task in it.

| You want to… | Example request |
| :--- | :--- |
| Build a web page | `Create a modern one-page website for a coffee shop: a menu with at least 6 items and prices, an about section and a contact section. Make it responsive and validate the contact form with JavaScript.` |
| Change it afterwards | `Make the headings dark blue and add a footer with a copyright notice.` |
| Write a command-line tool | `Write a command-line to-do list in Python with add, list, done and delete commands. Store the data in todos.json.` |
| Fix a bug and prove it | `The cart total is wrong after a discount is applied. Fix it and verify with npm test.` |
| Edit configuration | `Add a "start" script to package.json that runs node src/index.js.` |
| Repair a broken page | `The page lost its script and stylesheet tags. Fix it.` |
| Understand a codebase | `Explain the payment flow in the src folder step by step.` |

How a task runs:
1. The agent looks at the folder and works step by step. A request written as a numbered or bulleted list, or with steps joined by "then" / "sonra", becomes a checklist that has to be completed in full. Any other request is treated as one task, however many sentences it has.
2. Every file the agent writes is checked (HTML, CSS, JavaScript/TypeScript, Python, JSON, YAML, Java, C#, Go, Rust and more). Problems go back to the model with line numbers.
3. A web page task is reported as completed only when the page has real CSS, working JavaScript where the request needs it, a mobile viewport tag and only links to files that exist; when you ask for working menu links, every menu link must also lead somewhere. Otherwise the model is sent back to fix it, and if it still fails the task ends as incomplete with the failing checks listed.
4. An edit that would break a working file is not applied. Existing tests cannot be changed unless you ask for it, so a failing test has to be fixed in the code.
5. You see each change as a line-by-line diff. Depending on the approval level you approve it, or it is applied for you.
6. A follow-up request in the same session knows the previous request and the files it changed, so "now add a footer" works.
7. **Undo changes (n)** in the project bar restores every file the agent changed in the session, including edits you made to those files afterwards. The previous contents are kept in memory, so undo is available only until Emir Code is closed.

### Creation wizards
**New Project** offers an empty project or one of three wizards. The project folder is created when you confirm the wizard.
- **Website**: pages, sections, your own texts, contact details, interactions and a design theme. The app turns your answers into a detailed request with a page plan.
- **Mini App**: 21 small single-file web tools in 5 categories (calculators, productivity, tracking, utilities, fun & learning), each with its own settings page.
- **Script**: 13 command-line scripts in Python or Node.js in 3 categories (files & folders, data, text). Scripts only preview by default and change files only with `--apply`; they never delete or overwrite a file, back up files before changing them and log every action.

Confirming a wizard puts the request into the message box; nothing runs until you press send. New web pages the agent creates get one of 24 design themes after the agent has finished (Settings › Web design).

### Models
The Model Manager (**Ctrl+Shift+M**) lists the Ollama library from ollama.com by category (Recommended, Coding, Agents & tools, Reasoning, Vision & audio, Lightweight, Chat & general, Embedding). You can pick a size and quantization, see whether it fits this computer's memory and download it. Tags are checked against the Ollama registry before and after the download, and installed models show whether an update is available. The window also shows which models are loaded in memory and lets you unload or delete them.

### Approvals and limits
- **Approval** (project bar, or Settings › General › Agent approvals):
  - *Strict* (default): you approve every file change, deletion and command.
  - *Balanced*: file changes are applied without asking; commands and deletions need your approval.
  - *Autonomous*: file changes and test commands (`npm test`, `pytest`, `cargo test`) run without asking, and the agent answers its own questions. Deleting a file still needs your approval.
- The agent can only change files inside the project folder. `.env` files, `.git`, `node_modules`, build output folders and key or certificate files are off limits.
- It can only run `npm test`, `npm run test|build|lint|typecheck|check`, `node`, `python`, `pytest` and `cargo`. `npx` and shell commands are blocked.

Keyboard shortcuts: Ctrl+N new chat (in the Code tab: new task in the open project) · Ctrl+Shift+N new project · Ctrl+K command palette · Ctrl+Shift+M models · Ctrl+, settings.

---

## Which model to use

Results of the agent benchmark (`scripts/agent-e2e.ts`) on a laptop without a GPU (AMD Ryzen 5 7530U, 16 GB RAM). Times depend on the hardware; with a GPU every step is much faster.

| Model | Download | Results | Use it for |
| :--- | :---: | :--- | :--- |
| `qwen2.5-coder:7b` | 4.7 GB | Web page 3.5–10 min · follow-up edit 9 min · bug fix with `npm test` 3.3 min · `package.json` edit 4.7 min · Python CLI tested with real arguments 9.6 min | Agent tasks (recommended) |
| `qwen3:8b` | 5.2 GB | Web page 14.5 min · bug fix 5.5 min · Python CLI 28 min | Careful work; 2–3× slower on a CPU |
| `gemma2:2b` | 1.6 GB | Page repair 2.3 min · new web page 3.7 min in the latest run, inconsistent across runs | Chat and small edits |

All listed runs passed their checks. Settings › Agent sets the context length, the maximum output per step and "Think before each step" for thinking models such as qwen3; *Auto* picks values for this computer.

---

## Installation

### Requirements
1. Windows 10 or 11 (64-bit), or 64-bit Linux.
2. [Ollama](https://ollama.com) with at least one model, for example:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   The setup wizard on first start checks Ollama and Node.js and can download and install them. If Ollama is installed but not running, Emir Code starts it.
3. Node.js 18 or newer is optional; the agent needs it to run `npm` commands in your projects.

### Packages
Every release is on the [GitHub Releases](https://github.com/daristanapeyvan/emircode/releases) page.

**Windows**

| Package | File |
| :--- | :--- |
| Installer (recommended; choose the folder, Desktop and Start Menu shortcuts) | `Emir.Code.Setup.X.Y.Z.exe` |
| Portable, no installation | `Emir.Code.X.Y.Z.exe` |

**Linux**

| Package | Install |
| :--- | :--- |
| Debian, Ubuntu and derivatives: `emir-code_X.Y.Z_amd64.deb` | `sudo apt install ./emir-code_X.Y.Z_amd64.deb` |
| Fedora, openSUSE and other RPM systems: `emir-code-X.Y.Z.x86_64.rpm` | `sudo dnf install ./emir-code-X.Y.Z.x86_64.rpm` (or your package manager) |
| AppImage: `Emir.Code-X.Y.Z.AppImage` | `chmod +x Emir.Code-X.Y.Z.AppImage && ./Emir.Code-X.Y.Z.AppImage`. AppImages need FUSE 2 (`libfuse2t64` on Ubuntu 24.04, `libfuse2` on 22.04). |
| Setup script: `emir-code-setup-linux.sh` | `bash emir-code-setup-linux.sh` installs to `~/.local/share/emir-code` with a menu entry, a desktop shortcut, the `emir-code` command and `uninstall.sh`. It downloads the matching `.tar.gz` if it is not next to the script. |
| Archive: `emir-code-X.Y.Z.tar.gz` | Extract it and run `./emir-code`. |

On Linux, Settings › About › Create shortcuts adds Emir Code to the application menu, the desktop and `~/.local/bin`.

Where Chromium's sandbox cannot start (AppImage and archive copies on systems that restrict user namespaces, such as Ubuntu 23.10 and later), the `emir-code` launcher starts the app with `--no-sandbox` instead of failing. See [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md#linux-sandbox-fallback). The release workflow launches every Linux package on Ubuntu in a separate job, which reports problems without blocking the release.

### First steps
1. Open Emir Code and pick a model in the model selector in the title bar.
2. Chat: type a question. Switch on **Web** for questions about current events.
3. Code: create a project with **New Project** or open a folder, choose the approval level in the project bar and describe the task.
4. The **Logs** panel (button in the project bar) shows the agent's events and the model's raw output.

### Troubleshooting
- **The first agent step is slow.** The model is loaded and reads the whole task once; on a CPU this can take 1–3 minutes. Later steps reuse Ollama's cache.
- **The task stopped because the model repeated itself or made no progress.** These messages currently appear in Turkish in both languages: "DÖNGÜ TESPİT EDİLDİ" (loop detected) and "İLERLEME YOK" (no progress). Write the request more concretely (file names, expected result) or try a larger model.
- **The task ended with an amber card.** The agent finished, but some automatic checks did not pass; the card lists them. Continue in the same session, for example "also fix: …".
- **The taskbar shows an old icon after an update.** Windows caches icons; unpin and pin the app again, or sign out and back in.
- **No answer from Ollama.** Check that Ollama is running and that Settings › Ollama › Ollama address is correct (default `http://localhost:11434`).

---

## Privacy

- No telemetry, analytics or accounts. Chats, settings and tasks are stored on this computer (`emir_code_data.json` in the app's data folder).
- Prompts and code go only to the Ollama address in Settings (`http://localhost:11434` by default).
- Emir Code connects to the internet only for:
  - web access, which is on by default and can be switched off completely or separately for chat and the agent in Settings › Web access. Searches go to DuckDuckGo; the agent can also open web pages;
  - the Model Manager, which reads the model list from ollama.com and checks tags with registry.ollama.ai (the source `ollama pull` uses) while its Discover or Installed tab is open;
  - the setup wizard, when you ask it to download Ollama or Node.js.
- Pages the agent creates with a design theme load their fonts from Google Fonts unless Settings › Web design › Web fonts is off.

---

## Building from source

Requires Node.js 20 or newer (CI uses Node.js 22) and npm.

```bash
git clone https://github.com/daristanapeyvan/emircode.git
cd emircode
npm install
npm run dev              # Vite + Electron in development mode
npm test                 # all regression suites
npm run build:installer  # Windows installer and portable exe in release/
npm run build:linux      # Linux packages: deb, rpm, AppImage, tar.gz
```

The agent benchmark runs against a local Ollama model; the scenarios are listed at the top of `scripts/agent-e2e.ts`:

```bash
node ./scripts/run-ts-test.mjs scripts/agent-e2e.ts qwen2.5-coder:7b web-new
```

Pushing a `vX.Y.Z` tag starts the release workflow: it builds the Windows and Linux packages, launches the Linux packages in a virtual display and publishes the GitHub release.

---

## Documentation

- [docs/KULLANIM.md](./docs/KULLANIM.md): Turkish user guide.
- [docs/EXAMPLES.md](./docs/EXAMPLES.md): what happens during typical agent tasks.
- [ARCHITECTURE.md](./ARCHITECTURE.md): processes, agent loop, checks, themes, wizards, model library, packaging.
- [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md): what the app allows and blocks, and where the limits are.
- [SECURITY.md](./SECURITY.md): how to report a vulnerability.
- [CONTRIBUTING.md](./CONTRIBUTING.md): development setup, tests and conventions.
- [CHANGELOG.md](./CHANGELOG.md): release history.

Emir Code is written by Agah Emir and released under the [MIT License](./LICENSE).
