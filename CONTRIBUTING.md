# 🤝 Contributing to Emir Code

Thank you for your interest in contributing to **Emir Code**! We welcome bug reports, feature suggestions, documentation enhancements, and pull requests.

---

## 🛠️ Development Setup

1. **Prerequisites**:
   - Node.js 18+ and npm
   - Ollama running locally (`http://localhost:11434`)
   - Recommended model: `ollama pull qwen2.5-coder:7b`

2. **Clone and Install**:
   ```bash
   git clone https://github.com/emir/emir-code.git
   cd emir-code
   npm install
   ```

3. **Start Development Environment**:
   ```bash
   npm run dev
   ```

4. **Typecheck and Lint**:
   ```bash
   npm run build:vite
   ```

5. **Package Windows Installer**:
   ```bash
   npm run build
   ```

---

## 📐 Coding Conventions

- **Strict Typing**: No `any` where a concrete type or interface can be written.
- **Security First**: Never expose direct filesystem write APIs in Electron preload or IPC. All disk modifications must pass through `requestMutationToken` and `applyApprovedMutation`.
- **Bilingual Translations**: Whenever you add or alter user-facing strings, update both `src/lib/localization/translations/tr.ts` and `en.ts`.
- **Component Design**: Favor modular, reusable Tailwind CSS components.

---

## 🔀 Pull Request Process

1. Fork the repository and create a descriptive branch:
   ```bash
   git checkout -b feature/amazing-improvement
   ```
2. Write clean code and verify that `npm run build:vite` passes without warnings.
3. Commit with clear, descriptive messages:
   ```bash
   git commit -m "feat(agent): add interactive inline option chips"
   ```
4. Push to your branch and submit a Pull Request describing your changes, motivation, and testing steps.
