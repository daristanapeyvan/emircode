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
// Enforced in electron/main.ts
const resolvedPath = path.resolve(activeWorkspaceRoot, requestedPath);
const realPath = fs.realpathSync(resolvedPath);

if (!realPath.startsWith(activeWorkspaceRoot + path.sep) && realPath !== activeWorkspaceRoot) {
  throw new SecurityError(`Access Denied: Path escapes active workspace jail: ${requestedPath}`);
}
```

- **Symlink & Junction Safe**: Symbolic links pointing outside the workspace boundary are fully resolved to their ultimate physical targets before any read or write access is granted.
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
   - Specific target file path
   - Specific mutation operation (`create`, `modify`, `delete`)
   - Pre-mutation SHA-256 base hash of the file
   - Short 60-second expiration window
3. **Atomic Consumption**:
   Upon submission, the Main process verifies the base hash matches current disk state, invalidates the token immediately (preventing replay attacks), and executes the mutation.

---

### C. Atomic Swap via Temp-Files (`fs.renameSync`)

File corruption during power loss or system interruption is eliminated:
1. New contents are written to a temporary sibling file: `${targetPath}.tmp.${token}`.
2. Temporary file integrity is verified.
3. An atomic directory rename operation (`fs.renameSync`) replaces the original file in a single OS kernel step.

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
| **File Edit Prompt** | Manual | Auto (Non-conflicting) | Auto |
| **File Deletion Prompt** | Manual | Manual | Manual |
| **Terminal Command Execution** | Manual | Manual | Auto (Safe commands) |
| **Disallowed Commands Blocked** | ✅ Enforced | ✅ Enforced | ✅ Enforced |
