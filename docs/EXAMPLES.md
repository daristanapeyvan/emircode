# 📖 Emir Code: Practical Workflow Examples

This guide provides concrete, real-world examples demonstrating how Emir Code solves everyday software engineering tasks using local Ollama models with zero cloud dependencies and cryptographic sandbox isolation.

---

## Example 1: Autonomous Bug Hunting & Fixing

### Scenario
A React component in your codebase crashes with a `Cannot read properties of undefined (reading 'map')` runtime exception when API data is delayed.

### Step-by-Step Execution

1. **User Goal Input in Emir Code:**
   ```
   Fix the runtime TypeError in src/components/UserProfile.tsx where user.roles causes a crash when undefined. Add defensive fallback and a loading skeleton.
   ```

2. **Agent Engine Pre-Flight & Discovery:**
   - Pre-flight check inspects the workspace tree and locates `src/components/UserProfile.tsx`.
   - Tool `read_file` is invoked for `src/components/UserProfile.tsx`.
   - Content is parsed and stored in the **Session Memory Ledger**.

3. **Autonomous Reasoning & Diff Preparation:**
   - The model observes:
     ```tsx
     // Buggy Line:
     {user.roles.map(r => <span key={r}>{r}</span>)}
     ```
   - Prepares an atomic Myers/LCS diff:
     ```diff
     - {user.roles.map(r => <span key={r}>{r}</span>)}
     + {user.roles && user.roles.length > 0 ? (
     +   user.roles.map((r) => <span key={r} className="role-badge">{r}</span>)
     + ) : (
     +   <span className="text-zinc-500">No roles assigned</span>
     + )}
     ```

4. **Human-in-the-Loop Diff Verification:**
   - Under **Strict** security profile, Emir Code highlights exact green additions (`+`) and red deletions (`-`) in the rich Diff Viewer.
   - User reviews the diff and clicks **"Değişiklikleri Onayla" (Approve Changes)**.

5. **Atomic Execution:**
   - Main process issues a cryptographic single-use 256-bit token.
   - Verifies the SHA-256 base hash of `src/components/UserProfile.tsx`.
   - Writes to a `.tmp` file and performs an atomic directory swap via `fs.renameSync`.
   - Records a rollback snapshot.

---

## Example 2: Interactive Clarification Workflow (Non-Modal)

### Scenario
You ask the agent to create a database schema, but you haven't specified whether to use SQLite or PostgreSQL.

### Execution Flow

1. **User Goal:**
   ```
   Add a migration and storage adapter for user session persistence.
   ```

2. **Agent Decision Point:**
   - Rather than guessing or halting with an error, the agent invokes `ask_clarification`:
     ```json
     {
       "question": "Which storage engine would you like to use for session persistence?",
       "options": ["SQLite (Local file-based)", "PostgreSQL (Network client)", "In-Memory Map"]
     }
     ```

3. **Natural Inline Stream Rendering:**
   - No intrusive popup covers your screen.
   - A quiet, minimalist clarification card renders right inside the timeline stream with interactive option chips:
     `[ SQLite (Local file-based) ]` `[ PostgreSQL (Network client) ]` `[ In-Memory Map ]`
   - You click `[ SQLite (Local file-based) ]` (or type custom specifications).

4. **Continuous Progress:**
   - The answer is recorded in `ledger.userDecisions`.
   - The agent creates the migration file and adapter tailored specifically to your choice.

---

## Example 3: Multi-Step Refactoring with Rollback Safeguard

### Scenario
You ask the agent to rename a utility function used across 12 files. During step 8, you decide you want to revert everything back to the original state.

### Execution Flow

1. **Transaction Ledger:**
   - Every approved file modification is assigned a unique `txHash`:
     - `Tx #1: src/utils/formatters.ts (Modified)`
     - `Tx #2: src/components/Header.tsx (Modified)`
     - `Tx #3: src/components/Footer.tsx (Modified)`
   - The sub-header toolbar quietly shows: `[RotateCcw 3]`.

2. **One-Click Rollback:**
   - User clicks `[RotateCcw 3]`.
   - Emir Code reads the clean pre-mutation snapshots from the Main process vault and restores all 3 files atomically.
   - Discards invalid diffs without git dirtying.

---

## Example 4: Anti-Loop Guard in Action with Small Local Models

### Scenario
Running a smaller model (such as `qwen2.5-coder:1.5b` or `3b`) on limited hardware. The model attempts to execute `git diff` when Git is not installed on the host machine.

### Execution Flow

1. **Pre-flight Interception:**
   - Emir Code detects during startup that `git.exe` is absent.
   - `git` is marked in `ledger.unavailableBinaries`.
   - `read_git_diff` and `read_git_status` tools are dynamically omitted from the system prompt schema.

2. **Fallback Intercept:**
   - Even if the model tries calling `execute_command("git status")`, the Anti-Loop Guard intercepts the command before it reaches the OS:
     ```
     [Hata]: 'git' komutu sisteminizde bulunamadı. Lütfen doğrudan dosya okuma araçlarını kullanın.
     ```
   - The engine guides the model directly to `read_file` or `list_dir`, breaking the cycle in step 1.
