# Agent Task Examples

What happens inside Emir Code during typical tasks in the Code tab. The requests are in English here; requests in Turkish or other languages work the same way.

---

## 1. A new web page

**Request** (empty project folder):
```
Create a modern one-page website for a coffee shop: a menu with at least 6 items and prices, an about section and a contact section. Make it responsive and validate the contact form with JavaScript.
```

What happens:
1. `TaskCompiler` turns the request into acceptance checks: the page exists and is not a stub, it is a real HTML document, it has CSS rules, it has JavaScript that runs (the form must be validated), every linked local file exists, and it declares the mobile viewport tag.
2. The model answers every step with one JSON action, for example `{"thought": "...", "action": "write_file", "path": "index.html", "content": "<!DOCTYPE html>…"}`. The JSON schema passed to Ollama only allows complete actions of the enabled tools.
3. After each write the file checks run (unclosed tags, broken inline JavaScript, placeholder sections such as "content goes here"). The result goes back to the model, with the failing acceptance checks and the line to fix.
4. `finish` is refused while checks fail, at most twice. The task then ends with a green completion card listing the changed files, or with an amber card that lists what could not be verified.
5. After `finish`, a design theme is applied to the new page unless it is switched off in Settings › Web design.

## 2. A follow-up request in the same session

**Request** (after example 1):
```
Make the headings dark blue (#1e3a8a) and add a footer with a copyright notice.
```

What happens:
- The task message contains the previous request, its outcome and the changed files. In projects with up to 6 files, the current file contents are included as well, so the model edits the real page.
- Small changes are made with `edit_file` (find and replace) or `replace_lines` (a line range). A rewrite that would turn the page into a fragment, or delete most of it, is refused with a hint to use `edit_file`.
- You can also type a new instruction while a task is running (**Send instruction**). It is added to the running task, and requirements such as "add styles" are added to its acceptance checks.

## 3. Fix a bug and prove it with tests

**Request** (project with `package.json` and tests):
```
The cart total is wrong after a discount is applied. Fix it and verify with npm test.
```

What happens:
1. The agent reads the relevant files, fixes the calculation and proposes `npm test`.
2. Under Strict and Balanced you approve the command; under Autonomous test commands run without asking.
3. If a test fails, the output goes back to the model. When the output points into the project (`src/cart.js:14`, a Python traceback), the model also gets the numbered lines around that location.
4. A command that failed is not run again until a file has changed.
5. Existing test files cannot be changed unless the request asks for test changes, so the model has to fix the code instead of the failing assertion.

## 4. A command-line tool

**Request**:
```
Write a command-line to-do list in Python with add, list, done and delete commands. Store the data in todos.json.
```

What happens:
- Every Python file is checked after each write: unterminated strings, brackets, mixed tabs and spaces, and block indentation (for example `expected an indented block after line 12`).
- If the model runs `python todo.py` without arguments and the program prints its usage text, the result says that this is expected and that the program should be tested with real arguments (for example `python todo.py add "buy milk"`).
- There are no acceptance checks for scripts. The evidence is the program itself: if the model keeps repeating itself after a run of its own program succeeded, the task ends as completed with a note to check the result.

## 5. A question to the user

**Request**:
```
Add a storage layer for user sessions.
```

What happens:
- Under Strict and Balanced the model may call `ask_user`:
  ```json
  { "thought": "...", "action": "ask_user", "question": "Where should sessions be stored?", "options": ["SQLite", "PostgreSQL", "In memory (Map)"] }
  ```
  A card with the options appears in the task; click one or type your own answer. The answer is kept for the rest of the task, and asking the same question again is answered from it.
- Under Autonomous, `ask_user` is not offered to the model. If a model asks anyway, the first option is taken and the task continues.

## 6. Undoing the agent's changes

1. Every change the agent applies is recorded together with the previous file content.
2. **Undo changes (n)** in the project bar shows how many changes were applied in the session. Clicking it restores every file the agent created, edited or deleted to its state before the agent touched it. Changes you made to those files in the meantime are overwritten as well.
3. The previous contents are kept in memory. After Emir Code is closed and opened again, the undo is no longer possible; use git in the project if you need a lasting restore point.

## 7. A small model without Git

**Setup**: `gemma2:2b` on a computer where Git is not installed.

What happens:
- `git status` fails when the task starts, so `git_status` and `git_diff` are left out of the prompt and the JSON schema; the model cannot call them.
- For models up to about 4.5B parameters the tool list is shorter: `search_code` and `delete_file` are not offered.
- If the model runs a program that is not installed, the result is `[COMMAND UNAVAILABLE] … Do not call it again`, and the program is listed as unavailable in every following state line.
- A repeated action is answered with `[REPEATED]` and a way out ("If the task is complete, reply with finish now"). Three repeats in a row, or ten steps without progress, stop the task with a message.
