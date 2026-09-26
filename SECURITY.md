# Security Policy

Emir Code lets a local model read and change files in a project folder and run a small set of commands. What the app allows, what it blocks and where the limits are is described in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).

## Supported versions

Security fixes are made for the latest release on the [Releases](https://github.com/daristanapeyvan/emircode/releases) page.

## What to report

Please report anything that lets the agent, a project file, a web page or a model answer:
- read or change files outside the chosen project folder, or files the access rules block (such as `.env` or key files),
- start a program that is not on the command allowlist, or pass shell syntax to an allowed one,
- reach a private or local network address through web access,
- run code in the Electron main process or get access to Node.js from the interface.

## How to report

1. Do not open a public issue.
2. Report it privately on GitHub: [Security › Report a vulnerability](https://github.com/daristanapeyvan/emircode/security/advisories/new).
3. Include a description, the steps or a proof of concept, the impact you expect and the Emir Code version (Settings › About).

You will get a reply on GitHub, and the fix and its disclosure will be coordinated with you.
