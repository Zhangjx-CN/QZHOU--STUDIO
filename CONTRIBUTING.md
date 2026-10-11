# Contributing to Qingzhou

Please read [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md) first. Contributions should improve the complete experience of connecting external capabilities, reporting task state, managing projects, and finding generated artifacts.

## Development

Install dependencies as described in the README. Use `npm run build:app` to build the frontend and `npm start` to run the desktop app.

## Pull requests

Explain the problem, the reason for the change, how it was checked, and any known limitations. Do not commit `data/`, keys, real Session IDs, personal files, `node_modules/`, or build output. Keep lock files synchronized with dependency manifests.

Do not call paid upstream services without explicit authorization. CI must not access real models or Agents. Do not add simulated success to product logic.

## Bug reports

Include your operating system, reproduction steps, expected behavior, actual behavior, and sanitized error output. Never attach live keys or tokens to a public issue.
