## Description
Provide a concise explanation of what this pull request changes and why.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Architectural / Security refinement (changes to jail, token vault, or agent engine)
- [ ] UI / UX improvement (alignment with AAA minimalist standards)
- [ ] Documentation update

## Architectural & Security Verification
- [ ] All filesystem mutations strictly respect the Electron Main process **Realpath Jail**.
- [ ] Cryptographic mutation tokens and SHA-256 base hashes remain tamper-proof.
- [ ] No regression in Anti-Loop Guard or sliding-window context compression.
- [ ] Clean typecheck: `npx tsc --noEmit` passes with 0 errors.
- [ ] Clean build: `npm run build:vite` completes successfully.

## Screenshots (if applicable)
Add before/after screenshots demonstrating UI changes.
