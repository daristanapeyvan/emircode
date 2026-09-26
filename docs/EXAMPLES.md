# 📖 Emir Code: Practical Workflow Examples

Concrete walkthroughs of everyday tasks with local Ollama models. The requests are shown in Turkish (the app's primary language); English requests work the same way.

---

## Example 1: A New Web Page, Verified Before "Done"

**Request** (Code tab, empty folder):
```
Bir kahve dükkanı için tek sayfalık modern bir web sitesi oluştur: menü (en az 6 ürün, fiyatlarıyla), hakkımızda ve iletişim bölümleri olsun. Responsive olsun ve iletişim formu JavaScript ile doğrulansın.
```

**What happens**
1. `TaskCompiler` turns the request into acceptance checks: the page exists, is a real HTML document, contains CSS rules, contains JavaScript that runs (because the form must be validated), links only files that exist, and declares the mobile viewport tag.
2. The model answers with one JSON action per step, e.g. `{"thought": "...", "action": "write_file", "path": "index.html", "content": "<!DOCTYPE html>…"}`. Ollama's `format` schema guarantees a complete, valid action.
3. After the write, the file checks run (unclosed tags, broken inline JavaScript, placeholder sections such as "içerik buraya gelecek"). The model sees the result, e.g. `Acceptance checks still failing: 'index.html' dosyasında geçerli bir <script> bloğu … </body> etiketinden (satır 58) hemen önce … ekleyin.`
4. `finish` is refused until every check passes. The timeline ends with a green completion card listing the changed files — or an amber card that names what could not be verified.

## Example 2: Follow-Up Requests in the Same Session

**Request** (after Example 1):
```
başlıkların rengini koyu mavi (#1e3a8a) yap ve sayfanın en altına telif yazısı olan bir footer ekle
```

**What happens**
- The task message contains the previous request, its outcome and the changed files, plus the current content of small projects (up to 6 files), so the model edits the real page instead of guessing.
- A focused change is made with `edit_file` (find → replace) or `replace_lines` (line range → new text). If the model tries to replace the whole page with a fragment, the write is refused with guidance to use `edit_file`.
- Live steering works too: typing "şimdi CSS ile stil ekle" while a task is running adds the style requirement to the running checks.

## Example 3: Fix a Bug and Prove It with Tests

**Request** (project with `package.json` and tests):
```
indirim uygulanınca sepet toplamı yanlış hesaplanıyor, düzelt ve npm test ile doğrula
```

**What happens**
1. The agent reads the relevant files, fixes the calculation and proposes `npm test`.
2. Under **Strict** and **Balanced** you approve the command; under **Autonomous** test commands run automatically.
3. If a test fails, the output is returned to the model. When the output points into the project (`src/cart.js:14`, a Python traceback, …), the model also gets the numbered lines around that location.
4. The same failing command is not re-run until a file has changed.
5. Existing test files are protected: the model must fix the code, not rewrite the failing assertion (unless you ask it to change the tests).

## Example 4: A Command-Line Tool

**Request**:
```
Python ile komut satırından çalışan bir yapılacaklar listesi yaz: ekle, listele, tamamla ve sil komutları olsun; veriler todos.json dosyasında saklansın.
```

**What happens**
- Every Python file is checked after each write: unterminated strings, brackets, tab/space mix and block indentation (`expected an indented block after line 12`, `unexpected indent at line 8 — the cause is probably line 7 …`). f-strings of every Python version are understood.
- If the model runs `python todo.py` without arguments and the program prints its usage text, the result says that this is expected behaviour, not a bug, and that it should be tested with real arguments (e.g. `python todo.py ekle "süt al"`).

## Example 5: Clarification Without Pop-ups

**Request**:
```
Kullanıcı oturumlarını saklamak için bir depolama katmanı ekle
```

**What happens**
- In **Strict** and **Balanced**, the model may call `ask_user`:
  ```json
  { "thought": "...", "action": "ask_user", "question": "Oturumlar nerede saklansın?", "options": ["SQLite", "PostgreSQL", "Bellekte (Map)"] }
  ```
  A small card with option chips appears in the timeline; click one or type your own answer. The answer is remembered for the rest of the session, and a repeated question is answered from memory.
- In **Autonomous**, `ask_user` is not offered to the model at all; the agent decides itself.

## Example 6: Multi-Step Refactoring with Rollback

1. Every applied change is recorded with a snapshot of the previous content.
2. **Undo changes (n)** in the project bar shows the number of applied changes; clicking it restores every file changed in the session to its state before the agent touched it (changes you made to those files outside Emir Code in the meantime are overwritten too).

## Example 7: Small Models and Missing Tools

**Setup**: `gemma2:2b` on a laptop without Git installed.

**What happens**
- `git status` fails during the pre-flight probe, so `git_status` / `git_diff` are left out of the prompt and the JSON schema — the model cannot call them.
- If the model asks for a command that is not installed, the result is `[COMMAND UNAVAILABLE] … Do not call it again`, and the command is added to the unavailable list shown in every state line.
- Repeated identical actions are answered with `[REPEATED]` and an explicit way out ("If the task is complete, reply with finish now"); three repeats in a row, or ten steps without progress, stop the run with a clear message instead of wasting time.
