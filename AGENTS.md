# Agent Coordination

This file defines rules for AI coding agents working in this repo concurrently.

## Active Agents

| Agent | Config file | Branch prefix |
|-------|-------------|---------------|
| Claude Code | CLAUDE.md | `claude/` |
| Codex | AGENTS.md | `codex/` |

## Rules

### Before starting work
- Run `git pull --rebase` to get the latest changes
- Check `git branch -a` for branches the other agent may be working on
- Read this file for any updates to ownership or active tasks

### Branching
- Never commit directly to `main`
- Use your branch prefix: `claude/<topic>` or `codex/<topic>`
- Merge to main only via PR or after user approval

### Avoiding conflicts
- Check `git log --oneline -5 <file>` before editing a file another agent might touch
- If you see recent changes from the other agent, stop and ask the user
- Prefer working in separate directories when possible

### Shared codebase
All directories are shared — both agents can work anywhere. Before editing a file, check recent git history to avoid stepping on in-progress work.

### Communication via files
- Update this file if you change ownership or start a large task
- If you need the other agent to do something, leave a note in `TODO.md`
- If you're in the middle of a multi-step change, note it below

## Active Tasks

<!-- Agents: update this section when starting/finishing work -->

_No active tasks._
