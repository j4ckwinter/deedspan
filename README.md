# Short Stack

Developer tooling for exposing application actions to AI agents and checking that they complete tasks correctly.

This repository currently contains the TypeScript development foundation. The SDK, runner, and dashboard are not implemented yet.

## Development

Use Node.js 24 or newer and npm. An `.nvmrc` is provided for Node.js 24.

```sh
nvm use
npm ci
npm run check
```

## Commands

| Command                | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run lint`         | Check JavaScript and TypeScript with ESLint; warnings fail the check. |
| `npm run lint:fix`     | Apply available ESLint fixes.                                         |
| `npm run format`       | Format supported files with Prettier.                                 |
| `npm run format:check` | Check formatting without changing files.                              |
| `npm run typecheck`    | Check TypeScript without emitting build output.                       |
| `npm run check`        | Run lint, formatting, and type checks.                                |

ESLint handles code-quality rules; Prettier handles formatting. `eslint-config-prettier` disables conflicting lint rules. TypeScript uses strict checking.

GitHub Actions runs the same checks on pushes and pull requests. There is no application test suite yet; add behavior tests with the first implementation.

Make focused commits at working milestones and run `npm run check` before committing. Use Conventional Commit messages such as `chore: configure tooling` or `feat: add tool discovery`.

Local product notes in `PRODUCT_DIRECTION.md` remain ignored by Git and Prettier.
