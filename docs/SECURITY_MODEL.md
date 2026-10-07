# Emir Code Security Model

This document describes what Emir Code allows the agent to do, what it blocks and where the limits of these protections are. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

---

## What is protected against

An agent driven by a local model can be steered by text it reads (files, git output, web pages) and by its own mistakes. Emir Code is built to limit the damage in these cases:

1. **Instructions hidden in content.** A file, commit message or web page tells the model to read secrets, change files elsewhere or run programs.
2. **Paths outside the project.** The model asks for `../../`, an absolute path such as `C:\Windows\System32` or `~/.ssh/id_rsa`, or a symbolic link or junction that points outside the project folder.
3. **Unwanted commands.** The model tries to install packages, run a shell, chain commands or run code that is in no file.
4. **Programs that do more than they should.** A program the agent wrote or a test it runs reads other files, uses the network or starts other programs.
5. **Half-written or unwanted changes.** A crash during a write, or a change the user did not want.
6. **Leaked API keys.** The key of a cloud provider ends up in a file, in the window, in a program the agent runs, or at an address other than the provider's.

---

## Where the boundary is

The Electron main process owns all access to files, programs and the network. The window runs with `contextIsolation: true` and `nodeIntegration: false`; the interface and the agent engine reach the main process only through the functions of `window.electronAPI` (`electron/preload.ts`). Every file, command and web request is checked again in the main process, whatever the agent engine decided before.

The window shows only Emir Code's own interface: a link (in a chat answer, for example) opens in the system browser, and the window does not navigate to other pages.

The agent engine's own guards (section "Content guards") protect the project from model mistakes. They are not a security boundary.

---

## Project folder

Every file operation goes through `isCanonicalPathSafe` in the main process:
- The path is resolved against the canonical project folder. An existing target is resolved with `realpath`, so symbolic links and Windows junctions are followed to their real location. For a file that does not exist yet, the nearest existing parent folder is resolved.
- The result must be the project folder itself or lie inside it; otherwise the operation is refused.

On top of that, `evaluateAccessPolicy` refuses:
- `.env` files (only `.env.example` may be read),
- anything inside `.git` (git information is available only through the read-only git channel),
- anything inside `node_modules`, `dist`, `dist-electron`, `release`, `build`, `.next`, `.venv` and `__pycache__`,
- files ending in `.pem`, `.key`, `.id_rsa`, `.pfx` or `.pkcs12`,
- package manager and credential settings: `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pypirc`, `.netrc`, `_netrc`, `.git-credentials`, `pip.conf` and `pip.ini`. They can hold access tokens, and an `.npmrc` can make `npm test` run any program through its `script-shell` setting.

Code search skips the same paths.

---

## File changes

The agent's file changes use two steps in the main process:
1. `workspace:requestMutationToken` checks the path and the access rules, compares the file's current SHA-256 hash with the hash the agent read, and returns a random single-use token (32 bytes) bound to the path and the operation (`create`, `edit` or `delete`). The token expires after 5 minutes.
2. `workspace:applyApprovedMutation` accepts the change only with an unused, unexpired token for the same path and operation, and only if the file has not changed on disk since the token was issued. The token is then marked as used.

This prevents stale writes (the file changed after the agent read it), replays and mix-ups between files. It is not an approval check: approval happens in the interface before the token is requested. If the interface itself were compromised, it could request tokens; the boundary against that is the folder check, the access rules and the command rules.

**Writing.** The new content is written to a hidden temporary file next to the target (`.<name>.tmp.<uuid>`) and renamed over it, so an interrupted write does not leave a half-written file. The data is not flushed to disk explicitly, so a power loss right after a write can still lose it.

**Undo.** Before a change is applied, the main process keeps the previous content in memory. **Undo changes (n)** restores every change of the session and overwrites edits made to those files in the meantime. The copies are lost when the app closes; after a restart the undo no longer works.

**Files panel.** The Files panel's own **Delete** and **New folder** actions are the user's clicks, not the agent's. They use separate channels (`workspace:deleteItem`, `workspace:createDirectory`) with the same folder check and access rules, but without tokens. A delete there asks for confirmation, is permanent and is not part of the undo.

---

## Approval levels

| | Strict (default) | Balanced | Autonomous |
| :--- | :---: | :---: | :---: |
| Create or edit a file | Asks | Applied | Applied |
| Delete a file | Asks | Asks | Asks |
| A command that runs isolated | Asks | Asks | Runs |
| A test command (`npm test`, `npm run test`, `pytest`, `cargo test`) that runs write-protected or without isolation | Asks | Asks | Runs only while the task has written no code or command settings; otherwise asks |
| Any other command that runs write-protected or without isolation | Asks | Asks | Asks |
| Questions to the user (`ask_user`) | Shown in the task | Shown in the task | Not offered |

A test command runs the project's code. Outside the isolated environment, a test run after the agent wrote code (or `package.json`, `conftest.py`, `pytest.ini`, `pyproject.toml`, `Cargo.toml`, `build.rs` and similar) would run what the model just wrote, so in that case the user decides.

The approval dialog shows the command, the `package.json` script that `npm` will really run, and whether the command runs isolated, write-protected or neither, with the reason. The folder check, the access rules, the token check and the command rules apply at every level.

---

## Commands

`workspace:runApprovedCommand` is the only way the agent can start a program. The rules live in `electron/commandPolicy.ts`; the agent checks them before it asks for approval, so the user is never asked about a command that would be refused, and the main process checks them again.
- **Programs.** `npm`, `node`, `python`, `pytest` and `cargo`. `npx` is refused, also as part of an argument.
- **npm.** Only `npm test` and `npm run test|build|lint|typecheck|check`, and only if the project has a `package.json`. npm's own options (`--script-shell`, `--prefix` and the like) are refused; arguments for the script go after `--`.
- **Code on the command line.** `node -e`, `node -p` (also combined, such as `-pe`), `--eval`, `--print` and `--import`/`--require`/`--loader` with a `data:` URL are refused, and so is `python -c`. Only the options before the script count; arguments of the script itself are free.
- **Python modules.** `python -m` is allowed only for `pytest`, `unittest`, `doctest` and `py_compile` (so `python -m pip install` is refused).
- **cargo.** Only `build`, `check`, `test`, `run`, `fmt`, `clippy`, `bench` and `doc`.
- **Arguments.** Arguments containing `;`, `&`, `|`, `$`, `<`, `>`, backticks or line breaks are refused.
- **No shell.** Programs are started directly with an argument list. The exception is `npm` on Windows: it is a `.cmd` script, which Node.js does not start without a shell (CVE-2024-27980), so it runs through `cmd.exe` as one command line after the arguments have also been checked for `"`, `%`, `^`, `!`, `(` and `)`.
- **Environment.** Only `PATH`, the Windows system variables (`SystemRoot`, `COMSPEC`, `PATHEXT`), temporary folders, `HOME`, `USER`, `SHELL`, the locale and the XDG folders are passed on, plus `NODE_ENV=test` and `PYTHONIOENCODING=utf-8`. Other variables, such as tokens in your environment and `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OLLAMA_API_KEY`, are not.
- **Limits.** A command runs in the project folder, is stopped after 60 seconds together with the programs it started, and at most 2 MB of output is read.

These rules decide what may start. What a started program does is limited by the isolated environment (next section) as far as this computer provides it, and otherwise only by the user's approval: a program that runs without isolation has the same rights as the user.

---

## Isolated environment of commands

Settings › Agent › **Isolated commands** (on by default) runs commands in an isolated environment as far as the system provides one. The same settings page shows what applies on this computer. A command runs in one of three ways, and the approval dialog says which:

| | Files outside the project | Network | Other programs and the desktop |
| :--- | :--- | :--- | :--- |
| **Isolated** | Not readable, not writable | Blocked unless **Internet for isolated commands** is on | Out of reach |
| **Write-protected** (Windows only) | Readable, not writable | Open | Cannot be changed |
| **Without isolation** | Like any program of the user | Open | Like any program of the user |

Isolated programs get a home and temp folder of their own, so tools write their caches and settings there and not into the user's profile.

### Windows

`emir-sandbox.exe` (built from `native/windows/`, shipped in `resources/sandbox`) starts every command. What it can do depends on whether full isolation is set up.

**Full isolation (Settings › Agent › Full isolation › Set up).** Needs a Windows administrator once. The setup adds to this computer:
- two hidden local accounts, `EmirCodeSandbox` and `EmirCodeSandboxNet`, with random passwords (this user's copy is encrypted with DPAPI), no logon over the network or Remote Desktop;
- the local group `EmirCodeSandboxUsers` holding both;
- a block on every outgoing connection of `EmirCodeSandbox`, except connections to this computer itself: two filters in the Windows Filtering Platform (applied whether or not the Windows firewall is switched on) and a rule of the Windows firewall.

**Remove** on the same page deletes all of it again. Uninstalling Emir Code does not; remove it there first.

Every command then runs isolated, whole process trees (`npm`, `cargo`, test runners) included:
- The launcher logs the account on and starts the program as that account, with a restricted token, on a desktop of its own, inside a job object (128 processes, 8 GB, clipboard and window access cut, everything stopped with the launcher). The desktop is in the user's window station, where the account gets only what a process needs to start (no clipboard, no screen, no other desktops); that rule stays on the station until the user signs out.
- The account is not the user: it cannot open the user's profile (documents, desktop, application data, keys). The restricted token further limits it to what the account itself, the sandbox group, `Users` and `Everyone` are granted; rights given only to `Authenticated Users` (the default on other drives and on folders created under `C:\`) do not count, so those places are read-only.
- The project folder and the private home folder are opened to the sandbox group (modify, inherited). The folders above the project inside the user's profile get a rule for the folder itself that allows reading its attributes only, because programs such as Node walk the path of their files folder by folder. Tool folders in the user's profile that the command needs (`.cargo`, `.rustup`, the npm and Python user folders) are opened read-only. These rules stay on the folders.
- Without the network setting the command runs as `EmirCodeSandbox`, whose connections are blocked; with it, as `EmirCodeSandboxNet`.

Limits of full isolation:
- **Localhost stays reachable.** Connections to this computer itself are left open, because test suites start servers on `localhost` and connect to them. An isolated program can therefore also talk to local services such as Ollama or a local database.
- **Whatever every account of this computer can reach stays reachable**: Windows and installed programs can be read, a few shared places such as `C:\ProgramData` can be written to, and so can any folder whose access rules include `Users` or `Everyone`. When the folder that holds the project is such a folder, the approval dialog warns that the neighbouring folders are reachable.
- **The network block is tested, not assumed.** The app tries a real connection (to `1.1.1.1`, port 443, as the isolated account; nothing is sent). When it goes through, Settings › Agent says so, and commands are treated as not isolated for the Autonomous level.
- The Secondary Logon service of Windows must not be disabled.

**Without full isolation**, a command runs in one of two ways:
- **Isolated in an AppContainer:** `python`, `pytest` (as `python -m pytest`) and `node file.js`. The container reads and writes only the project folder (opened to a capability of the container, `S-1-15-3-1024-…`) and has no network at all, `localhost` included; with the network setting it gets the `internetClient` capability. Node cannot start other programs in an AppContainer (the named pipes it needs are not allowed there), so a small guard makes such calls fail at once with a clear message. Python installed by an administrator outside Program Files (`C:\Python3xx`) cannot be read by AppContainers; the **Python** row in Settings › Agent offers to add the read rule that Program Files has, after an administrator prompt, and until then Python runs write-protected.
- **Write-protected:** `npm`, `cargo`, Node's test runner, and whatever cannot run in the AppContainer. The program runs at the low integrity level in a job object, on a window station and desktop of its own. Windows refuses its writes to everything of the normal level, so it cannot change files, registry keys or other programs outside the project (the project folder is marked as writable for it; the mark stays on the folder). It can still read the user's files and use the network. This limits damage; it does not keep anything secret, and the app does not call it isolation.

### Linux: bubblewrap

When `bwrap` is installed and the system allows unprivileged user namespaces, every command runs in it: the whole system is mounted read-only, the home folders are replaced by empty private ones (only the project folder and the folders of language tools such as `.nvm`, `.pyenv`, `.cargo` and `.local/lib` come back, read-only), `/tmp` is private and the network is cut unless allowed. A program can write into those private folders, but what it writes there is kept in memory and is gone when it ends; only the project folder reaches the disk. When it is allowed, the program uses this computer's network as it is, including local services such as Ollama on `localhost`. Programs may start other programs inside the isolation. Files outside the home folders that every user can read (for example under `/etc` or on another disk) stay readable.

### Elsewhere

On other systems (macOS is not a target of Emir Code), when the tool is missing, or with the setting off, commands run without isolation.

---

## Git

The agent's git channel runs only `git status --porcelain=v1`, `git diff` and `git log -n 10 --oneline`, without approval. A repository's own settings can make git run programs: an `fsmonitor` command, hooks, external diff and textconv drivers, clean and smudge filters, signature checks. For these calls they are switched off (`core.fsmonitor=false`, an empty hooks folder, `--no-ext-diff`, `--no-textconv`, every configured filter emptied, `--no-optional-locks`, submodules ignored), so opening a downloaded project does not turn the agent's git calls into the project's commands.

---

## Content from outside

File contents, code search results, git output, the project snapshot and web results are wrapped in markers before they reach the model (`<<<UNTRUSTED_PROJECT_DATA: path>>>`, `<<<UNTRUSTED_PROJECT_SEARCH_RESULTS: "query">>>`, `<<<UNTRUSTED_GIT_OUTPUT: action>>>`, `<<<WORKSPACE_SNAPSHOT_UNTRUSTED_DATA>>>`, `<<<WEB_RESULT_UNTRUSTED>>>`), and the system prompt says that such text is data and never an instruction. A model can still be misled; the limits above are what stop it from acting outside the project.

---

## Web access

Web access is on by default. It can be switched off completely, or separately for chat and for the agent, in Settings › Web access. When it is off for the agent, the web tools are not offered to the model, and both `ToolDispatcher` and `AgentEngine` refuse a web call that appears anyway. Switching any of these off stops the requests that are still running; stopping a task or a chat answer stops its own requests.

The chat searches before answering only when the question clearly needs current information (weather, prices, news, people and places, or an explicit request to search); a programming question is answered from the model, unless the user asks for a search. After a search the chat reads the first result page that has text, so the answer does not rest on short snippets alone.

All web requests are made by the main process (`electron/web.ts`):
- Only `http` and `https` addresses without a user name or password are allowed.
- Refused host names: `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan`.
- Refused addresses: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0` and above; IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`, and IPv4-mapped, IPv4-compatible, NAT64 and 6to4 addresses of the IPv4 ranges above.
- The address check runs when the connection is made: every address the name resolves to must be public, and the connection uses one of exactly those addresses. A name cannot pass the check and then resolve to a private address for the request.
- Redirects are followed manually, at most 3, and every target is checked the same way.
- A request stops after 10 seconds. The answer is read as a stream (and decompressed) and cut at the size limit (512 KB by default, 256 KB for the agent and the chat, never more than 2 MB); nothing larger is held in memory. Only text answers are read (HTML, plain text, XML, JSON).
- Searches go to DuckDuckGo Lite; results with local addresses are dropped. If the search page cannot be read (its layout changed, or it shows a check for bots), the search fails with that message instead of reporting no results.

The Model Manager's requests use separate functions (`models:library`, `models:tags`, `models:manifest`) that build fixed URLs on ollama.com and registry.ollama.ai from validated model names and reject responses that end on another host.

---

## Cloud models

Ollama Cloud, Claude (Anthropic) and GPT (OpenAI) are used only after the user enters an API key (or, for Ollama Cloud, signs in the local Ollama with `ollama signin`) and selects one of their models.

**API keys** (`electron/cloud/keyStore.ts`):
- A key is saved only after the provider's model list could be read with it. It is stored in `cloud_keys.json` in the app's data folder, written with mode 600, and encrypted with Electron `safeStorage`, which uses the system's key store: DPAPI on Windows, libsecret (GNOME Keyring) or KWallet on Linux. Keys are never part of `emir_code_data.json`, so backups or exports of the chats do not contain them.
- On Linux without a key store, `safeStorage` falls back to a fixed password (`basic_text`). Emir Code does not treat that as encryption: the key is then kept in the main process's memory until the app closes, and Settings › Cloud models says so.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OLLAMA_API_KEY` are read from the app's environment when no key is saved.
- The key stays in the main process. The window can save, replace or remove a key and learns only whether one is set, where it comes from and its last four characters; no IPC channel returns a key. Programs the agent runs do not get the variables above (see Commands), and `cloud_keys.json` is outside every project folder, so the agent's file tools cannot read it.

**Where requests go** (`electron/cloud/`):
- Each provider has one fixed address: `https://api.anthropic.com`, `https://api.openai.com/v1` and `https://ollama.com`. `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `OPENAI_BASE_URL` in the environment are ignored, and requests to ollama.com do not follow redirects, so a key is sent to its provider only. The window cannot choose an address.
- Requests from the window are checked in the main process before they are sent: a known provider, a model id of letters, digits and `. _ : / @ -`, the roles `system`, `user`, `assistant` and `tool`, numeric generation options only, and at most 48 MB including images. Requests of a window that was closed are stopped.

**What the provider receives.** With a cloud model selected, the chat sends the conversation, the system instructions, attachments and web results; the agent sends its system prompt, the task, the files it reads, search results, git output, command output and web results, every step. The provider processes them under its own terms (retention, training, location). Emir Code adds no telemetry or identifiers of its own. An Ollama Cloud model added to the local Ollama (`…-cloud` tags) sends the same data to ollama.com through Ollama.

**What does not change.** A cloud model is driven by the same agent engine: every file, command and web request still goes through the checks, approvals and isolation of this document, and content from files and the web is still marked as untrusted. A cloud model can be misled by hidden instructions just like a local one.

Limits:
- A program running as the user can ask the system's key store to decrypt `cloud_keys.json` just as Emir Code does; the encryption protects against copies of the file and other accounts, not against malware in the user's session.
- While Emir Code runs, the keys are in the main process's memory.
- A key in an environment variable is visible to every program started from that environment (but not to the agent's commands).
- Emir Code cannot limit what a provider does with the data it receives, nor the costs a task causes; the provider's own spending limits apply.

---

## Linux sandbox fallback

Chromium's renderer sandbox needs either a root-owned SUID `chrome-sandbox` helper or unprivileged user namespaces. AppImage and `.tar.gz` copies cannot have the SUID helper, and Ubuntu 23.10 and later restrict user namespaces with AppArmor, so there the plain Electron binary exits at startup. The `emir-code` launcher (generated by `scripts/afterPack.js`) keeps the sandbox where it works and adds `--no-sandbox` only where it cannot start. Set `EMIR_CODE_FORCE_SANDBOX=1` to turn the fallback off, or install the `.deb` or `.rpm` package, which sets up the SUID helper.

Without the renderer sandbox, the file, command and network rules above still apply, because they are enforced in the main process. The window loads only Emir Code's bundled interface, and links open in the system browser. On such systems bubblewrap usually cannot start either, so commands run without isolation; Settings › Agent shows it.

---

## Content guards

Before a file is written, the agent engine refuses content that would damage the project: empty files, placeholders instead of code ("rest of the code…"), status sentences written over a file, changes to existing tests the user did not ask for, edits that break a working file or make a broken one worse, invalid JSON over a valid config file, rewrites that would drop most of a file or existing `package.json` keys, and re-applying an edit that was already applied. The same change refused again for the same fault makes the agent show the model the file's current lines and a different way to make the change, and counts toward the loop limit. After every write, per-language checks report problems back to the model with line numbers. These guards are about quality, not security.
