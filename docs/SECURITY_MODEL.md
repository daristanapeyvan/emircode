# 🛡️ Emir Code Security Model & Sandbox Architecture

Security is the primary foundational pillar of Emir Code. This document outlines the cryptographic controls, process isolation, and attack surface mitigations implemented throughout the application.

---

## 1. Threat Model & Design Assumptions

When running autonomous coding agents powered by LLMs, developers face three primary attack vectors:

1. **Prompt Injection & Indirect Code Execution**: Malicious text inside a scanned file or git commit instructing the model to exfiltrate files or execute arbitrary shell commands.
2. **Directory Traversal & Jailbreak**: Models attempting to access sensitive operating system directories (e.g., `C:\Windows\System32`, `~/.ssh/id_rsa`, `~/.aws/credentials`).
3. **Partial Write Corruption & Race Conditions**: Crashes during file writes leaving source files truncated or corrupt.

---

## 2. Core Defenses

### A. The Electron Main Process Realpath Jail
The Chromium Renderer process (where UI and Ollama streaming take place) is treated as **untrusted**. The Electron Main process enforces operating-system-level confinement:

```ts
// Enforced in electron/main.ts (simplified)
const resolvedTarget = path.resolve(canonicalWorkspaceRoot, requestedPath);
const canonicalTarget = fs.existsSync(resolvedTarget)
  ? await fs.promises.realpath(resolvedTarget) // symlinks and junctions resolved
  : resolvedTarget;                            // new file: its nearest existing parent is realpath-checked
const isInside =
  canonicalTarget === canonicalWorkspaceRoot || canonicalTarget.startsWith(canonicalWorkspaceRoot + path.sep);
if (!isInside) return { safe: false, error: 'Güvenlik İhlali: ...' };
```

- **Symlink & Junction Safe**: Symbolic links pointing outside the workspace boundary are fully resolved to their ultimate physical targets before any read or write access is granted; for files that do not exist yet, the nearest existing parent folder is resolved and must be inside the workspace.
- **Unbypassable**: The renderer process has `nodeIntegration: false` and `contextIsolation: true`. It cannot make direct `node:fs` calls.

---

### B. Cryptographic 256-Bit Single-Use Mutation Tokens

No mutation (file create, edit, or delete) can occur with just a file path and content. Every modification requires an unforgeable, one-time token:

1. **Token Generation**:
   ```ts
   const token = crypto.randomBytes(32).toString('hex'); // 256-bit crypto randomness
   ```
2. **State Binding**:
   The token is bound to:
   - the canonical target path,
   - the mutation operation (`create`, `edit`, `delete`),
   - the pre-mutation SHA-256 base hash of the file,
   - a 5-minute expiration window (long enough for a user to review a diff).
3. **Atomic Consumption**:
   Upon submission, the Main process verifies the base hash matches current disk state, invalidates the token immediately (preventing replay attacks), and executes the mutation.

---

### C. Atomic Swap via Temp-Files

File corruption during power loss or system interruption is eliminated:
1. New contents are written to a hidden temporary sibling file: `.<name>.tmp.<uuid>`.
2. A rename replaces the original file in a single filesystem operation.

---

### D. Snapshot & One-Click Rollback Vault

Before any file is modified on disk:
- The exact original state is preserved in an in-memory / local snapshot ring.
- If an agent makes a mistaken refactor, the user can click **Geri Al (Rollback)** to restore all files to their pristine state instantly.

---

## 3. Security Profiles Comparison

| Feature | Strict | Balanced | Autonomous |
| :--- | :---: | :---: | :---: |
| **Realpath Jail Containment** | ✅ Enforced | ✅ Enforced | ✅ Enforced |
| **Mutation Token Verification** | ✅ Enforced | ✅ Enforced | ✅ Enforced |
| **Atomic Temp Swap** | ✅ Enforced | ✅ Enforced | ✅ Enforced |
| **File Create / Edit** | Manual approval | Auto (base-hash checked) | Auto (base-hash checked) |
| **File Deletion** | Manual approval | Manual approval | Manual approval |
| **Test Commands** (`npm test`, `npm run test`, `pytest`, `cargo test`) | Manual approval | Manual approval | Auto |
| **Other Allowed Commands** (`node`, `python`, `npm run build/lint/…`) | Manual approval | Manual approval | Manual approval |
| **Agent Questions** (`ask_user`) | Asked inline | Asked inline | Disabled (first option chosen) |
| **Disallowed Commands Blocked** (`npx`, shells, other binaries) | ✅ Enforced | ✅ Enforced | ✅ Enforced |

### Automatic content guards (all profiles)
Before a file is written, the agent engine refuses content that would damage the project: empty files, placeholders instead of code ("rest of the code…"), status sentences written over a file's content, edits to existing tests the user did not ask for, edits that would break a working file or make a broken one worse, invalid JSON over a valid config, rewrites that would drop most of a file or existing `package.json` keys, and re-applying an edit that was already applied. After every write, per-language checks (JSON, JS/TS, Python, HTML, CSS, YAML, …) report problems back to the model with line numbers. These guards protect the project from model mistakes; they are not a security boundary — the boundary is the main process.

---

## 4. Zero-Trust Web Access & Anti-SSRF Defense

Web access in Emir Code is zero-trust and hardened against injection and infrastructure reconnaissance attacks. It is enabled by default and can be switched off completely, or separately for chat and for the agent, in Settings → Web Access:

### A. Zero-Trust Untrusted Boundary Delimiters
All search snippets and fetched external web contents are quarantined within:
```text
<<<WEB_RESULT_UNTRUSTED>>>
(External Web Data)
<<<END_WEB_RESULT_UNTRUSTED>>>
```
System prompts explicitly instruct the model that content inside these delimiters represents plain external untrusted text and must NEVER be treated as authorization or system instruction overrides.

### B. Anti-DNS-Rebinding & Multi-IP SSRF Shield
- **Multi-Record DNS Resolution**: Resolves all A and AAAA records (`{ all: true }`). If any address belongs to private/reserved ranges, the entire request is blocked.
- **Forbidden IP Ranges**: Completely blocks IPv4 loopback (`127.0.0.0/8`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), multicast/reserved (`224.0.0.0/4`), IPv6 loopbacks (`::1`, `::`), link-local (`fe80::/10`), and unique-local (`fc00::/7`).
- **Redirect Re-Validation**: Every redirect hop (HTTP 301, 302, 303, 307, 308) is checked manually up to 3 hops from scratch.
- **Main Process Authority**: The renderer process has no direct network capability for web search/fetch; all requests execute exclusively in the privileged Electron Main process through hardened IPC channels (`web:search`, `web:fetchUrl`, `web:abortAll`).
- **Instant Abort on Disable**: If the user turns Web Access OFF in settings, all in-flight requests are immediately aborted.

---

## 5. Command Execution

`workspace:runApprovedCommand` in the main process is the only way to start a program:

- **Allowlist**: `npm` (only `test` and `run test|build|lint|typecheck|check`, and only if the project has a `package.json`), `node`, `python`, `pytest`, `cargo`. `npx` is blocked even as an argument.
- **Argument filter**: arguments containing `; & | $ < >`, backticks or line breaks are rejected.
- **No shell**: programs are spawned directly with an argument array. The one exception is `npm` on Windows: it is a `.cmd` script, which Node.js refuses to spawn without a shell (CVE-2024-27980), so it runs through `cmd.exe` as one command string — after every `cmd.exe` metacharacter (`" % ^ ! ( )`) has additionally been rejected in the arguments.
- **Minimal environment**: only `PATH`, temp/home folders, locale and a few system variables are passed; `PYTHONIOENCODING=utf-8` makes Python output readable for the agent.
- **Timeout**: commands are killed (with their process tree on Windows) after the timeout.

## 6. Linux Renderer Sandbox

Chromium's renderer sandbox needs a root-owned SUID `chrome-sandbox` helper or unprivileged user namespaces. AppImage and tar.gz copies cannot have a SUID helper, and Ubuntu 23.10+ restricts user namespaces with AppArmor, so there the plain Electron binary exits at startup. The `emir-code` launcher (generated by `scripts/afterPack.js`) keeps the sandbox wherever it can work and adds `--no-sandbox` only where it cannot. This does not change the boundaries above: the renderer only loads Emir Code's own bundled interface (no remote pages are rendered in it), and file, command and network authority remains in the main process. `EMIR_CODE_FORCE_SANDBOX=1` disables the fallback.

