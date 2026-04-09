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

### Phase 3: mobile-v2 (parallel work)

**Task A — Auth setup (Claude Code)**
Files: `mobile-v2/package.json`, `mobile-v2/app/_layout.tsx`, `mobile-v2/lib/logto.ts`, `mobile-v2/app/(auth)/`, `mobile-v2/app/(app)/`, `mobile-v2/app/index.tsx`
- Install `@logto/rn expo-crypto expo-secure-store expo-web-browser`
- Create `lib/logto.ts` with config (appId: `un96c8vwvshdv84vi3qvs`, endpoint: `http://localhost:3302`, resource: `https://api.myapp.local`)
- Wrap root layout in `LogtoProvider`
- Add auth routing: `(auth)/sign-in.tsx` and `(app)/index.tsx` with layout guards
- Inject Logto access token into the transport's fetch headers

**Task B — Backend integration (Codex)**
Files: `mobile-v2/hooks/use-app-runtime.ts`, `mobile-v2/app/api/chat+api.ts`, `mobile-v2/app.json`, `mobile-v2/.env.local`
- Update `use-app-runtime.ts`: point `AssistantChatTransport` to `EXPO_PUBLIC_BACKEND_BASE_URL` (default `http://localhost:7081/api/chat`)
- Remove or repurpose `app/api/chat+api.ts` (demo OpenAI proxy — not needed, our backend serves `/v1/chat/completions`)
- Update `app.json`: name → `mobile-v2`, slug → `mobile-v2`, scheme → `io.logto.mobile-v2`, bundleIdentifier → `com.myapp.mobile-v2`
- Create `.env.local` with `EXPO_PUBLIC_BACKEND_BASE_URL=http://192.168.50.253:7081` and `EXPO_PUBLIC_CHAT_ENDPOINT_URL=http://192.168.50.253:7081/v1/chat/completions`
- Delete `app/.index.tsx.swp` (vim swap file)
- Remove demo weather/geocode tools from `components/assistant-ui/tools.tsx` and references in `_layout.tsx`
