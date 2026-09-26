## What changes and why

## How it was tested

## Checklist
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes; an agent fix comes with a check in `test_agent_reliability.ts` or `test_agent_engine.ts`.
- [ ] File, command and network access still goes through the checks in `electron/main.ts` (see docs/SECURITY_MODEL.md).
- [ ] New or changed interface texts are in both `en.ts` and `tr.ts`.
- [ ] Interface changes were checked in the dark and the light theme (screenshots below).
- [ ] Documentation is updated if behaviour changed.

## Screenshots
