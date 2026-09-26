# Emir Code Security Model

This document describes what Emir Code allows the agent to do, what it blocks and where the limits of these protections are. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

---

## What is protected against

An agent driven by a local model can be steered by text it reads (files, git output, web pages) and by its own mistakes. Emir Code is built to limit the damage in these cases:

1. **Instructions hidden in content.** A file, commit message or web page tells the model to read secrets, change files elsewhere or run programs.
2. **Paths outside the project.** The model asks for `../../`, an absolute path such as `C:\Windows\System32` or `~/.ssh/id_rsa`, or a symbolic link or junction that points outside the project folder.
3. **Unwanted commands.** The model tries to install packages, run a shell or chain commands.
4. **Half-written or unwanted changes.** A crash during a write, or a change the user did not want.

---

## Where the boundary is

The Electron main process owns all access to files, programs and the network. The window runs with `contextIsolation: true` and `nodeIntegration: false`; the interface and the agent engine reach the main process only through the functions of `window.electronAPI` (`electron/preload.ts`). Every file, command and web request is checked again in `electron/main.ts`, whatever the agent engine decided before.

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
- files ending in `.pem`, `.key`, `.id_rsa`, `.pfx` or `.pkcs12`.

Code search skips the same paths.

---

## File changes

The agent's file changes use two steps in the main process:
1. `workspace:requestMutationToken` checks the path and the access rules, compares the file's current SHA-256 hash with the hash the agent read, and returns a random single-use token (32 bytes) bound to the path and the operation (`create`, `edit` or `delete`). The token expires after 5 minutes.
2. `workspace:applyApprovedMutation` accepts the change only with an unused, unexpired token for the same path and operation, and only if the file has not changed on disk since the token was issued. The token is then marked as used.

This prevents stale writes (the file changed after the agent read it), replays and mix-ups between files. It is not an approval check: approval happens in the interface before the token is requested. If the interface itself were compromised, it could request tokens; the boundary against that is the folder check, the access rules and the command allowlist.

**Writing.** The new content is written to a hidden temporary file next to the target (`.<name>.tmp.<uuid>`) and renamed over it, so an interrupted write does not leave a half-written file. The data is not flushed to disk explicitly, so a power loss right after a write can still lose it.

**Undo.** Before a change is applied, the main process keeps the previous content in memory. **Undo changes (n)** restores every change of the session and overwrites edits made to those files in the meantime. The copies are lost when the app closes; after a restart the undo no longer works.

**Files panel.** The Files panel's own **Delete** and **New folder** actions are the user's clicks, not the agent's. They use separate channels (`workspace:deleteItem`, `workspace:createDirectory`) with the same folder check and access rules, but without tokens. A delete there asks for confirmation, is permanent and is not part of the undo.

---

## Approval levels

| | Strict (default) | Balanced | Autonomous |
| :--- | :---: | :---: | :---: |
| Create or edit a file | Asks | Applied | Applied |
| Delete a file | Asks | Asks | Asks |
| Test commands (`npm test`, `npm run test`, `pytest`, `cargo test`) | Asks | Asks | Runs |
| Other allowed commands (`node`, `python`, `npm run build`, …) | Asks | Asks | Asks |
| Questions to the user (`ask_user`) | Shown in the task | Shown in the task | Not offered |

The folder check, the access rules, the token check and the command allowlist apply at every level.

---

## Commands

`workspace:runApprovedCommand` is the only way the agent can start a program:
- **Allowlist.** `npm` (only `npm test` and `npm run test|build|lint|typecheck|check`, and only if the project has a `package.json`), `node`, `python`, `pytest` and `cargo`. `npx` is refused, also as part of an argument.
- **Arguments.** Arguments containing `;`, `&`, `|`, `$`, `<`, `>`, backticks or line breaks are refused.
- **No shell.** Programs are started directly with an argument list. The exception is `npm` on Windows: it is a `.cmd` script, which Node.js does not start without a shell (CVE-2024-27980), so it runs through `cmd.exe` as one command line after the arguments have also been checked for `"`, `%`, `^`, `!`, `(` and `)`.
- **Environment.** Only `PATH`, the Windows system variables (`SystemRoot`, `COMSPEC`, `PATHEXT`), temporary folders, `HOME`, `USER`, `SHELL`, the locale and the XDG folders are passed on, plus `NODE_ENV=test` and `PYTHONIOENCODING=utf-8`. Other variables, such as tokens in your environment, are not.
- **Limits.** A command runs in the project folder, is stopped after 60 seconds together with its child processes, and at most 2 MB of output is read.

**Git** has its own read-only channel that runs only `git status --porcelain=v1`, `git diff` and `git log -n 10 --oneline`. The agent's tools use status and diff.

---

## Content from outside

File contents, code search results, git output, the project snapshot and web results are wrapped in markers before they reach the model (`<<<UNTRUSTED_PROJECT_DATA: path>>>`, `<<<UNTRUSTED_PROJECT_SEARCH_RESULTS: "query">>>`, `<<<UNTRUSTED_GIT_OUTPUT: action>>>`, `<<<WORKSPACE_SNAPSHOT_UNTRUSTED_DATA>>>`, `<<<WEB_RESULT_UNTRUSTED>>>`), and the system prompt says that such text is data and never an instruction. A model can still be misled; the limits above are what stop it from acting outside the project.

---

## Web access

Web access is on by default. It can be switched off completely, or separately for chat and for the agent, in Settings › Web access. When it is off for the agent, the web tools are not offered to the model, and both `ToolDispatcher` and `AgentEngine` refuse a web call that appears anyway. Switching it off aborts requests that are still running.

All web requests are made by the main process (`web:search`, `web:fetchUrl`, `web:abortAll`):
- Only `http` and `https` addresses are allowed.
- Refused host names: `localhost`, `*.localhost`, `*.local`, `*.internal`, `0.0.0.0`.
- The host name is resolved to all its addresses, and the request is refused if any of them is private or reserved: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0` and above; IPv6 `::`, `::1`, addresses starting with `fc`, `fd` or `fe80:`, and IPv4-mapped addresses of the ranges above.
- Redirects are followed manually, at most 3, and every target is checked the same way.
- A page fetch stops after 10 seconds and reads at most 512 KB. Searches go to DuckDuckGo Lite; each result's address is checked before it is used.

The request itself resolves the host name again. A DNS server that answers with a public address during the check and a private one for the request is therefore not caught.

The Model Manager's requests use separate functions (`models:library`, `models:tags`, `models:manifest`) that build fixed URLs on ollama.com and registry.ollama.ai from validated model names and reject responses that end on another host.

---

## Linux sandbox fallback

Chromium's renderer sandbox needs either a root-owned SUID `chrome-sandbox` helper or unprivileged user namespaces. AppImage and `.tar.gz` copies cannot have the SUID helper, and Ubuntu 23.10 and later restrict user namespaces with AppArmor, so there the plain Electron binary exits at startup. The `emir-code` launcher (generated by `scripts/afterPack.js`) keeps the sandbox where it works and adds `--no-sandbox` only where it cannot start. Set `EMIR_CODE_FORCE_SANDBOX=1` to turn the fallback off, or install the `.deb` or `.rpm` package, which sets up the SUID helper.

Without the sandbox, the file, command and network rules above still apply, because they are enforced in the main process. The main window loads only Emir Code's bundled interface. The app has no handler that sends links to the system browser, so a link in a chat answer opens in a new Electron window, and with the fallback that window also runs without the sandbox.

---

## Content guards

Before a file is written, the agent engine refuses content that would damage the project: empty files, placeholders instead of code ("rest of the code…"), status sentences written over a file, changes to existing tests the user did not ask for, edits that break a working file or make a broken one worse, invalid JSON over a valid config file, rewrites that would drop most of a file or existing `package.json` keys, and re-applying an edit that was already applied. After every write, per-language checks report problems back to the model with line numbers. These guards are about quality, not security.
