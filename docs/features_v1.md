This is the first milestone on feature work (on top from current baseline frontend)

1. New thread suggestions: current behavior: show Hello there! How can I help you today? goal is to generate initial suggestion based on entries randomly draw from collection from milvis started rag_bot_qa... (and latestest). Noted, these are question and answer parsed, when we generate suggestion, we should not directly use the query, but rephased with casual style. Noted also backend should cached to avoid constant db query.

### Frontend review

- This feels like a good milestone-1 feature because it is visible immediately on first load and does not depend on an active thread.
- Frontend assumption: backend should return already-curated suggestion strings, not raw source questions. I agree with not exposing corpus queries directly; the frontend should render friendly prompts, not do any client-side paraphrasing.
- Frontend preference: suggestions should arrive as plain display text plus an optional stable id. If backend wants analytics later, ids will help without forcing us to use display text as the key.
- Frontend question: should these suggestions be fetched once on page load and reused until refresh, or regenerated each time the user clicks `New Thread`?
- Frontend question: do we want a fixed count, e.g. 4 suggestions, or should the UI adapt to however many the backend returns?
- Frontend question: should clicking a suggestion send it immediately, or prefill the composer so the user can edit it first? Current welcome suggestions send immediately. I would keep that unless product wants more user control.
- Frontend comment: if backend caching is required, I would prefer the frontend stay stateless here and just consume an endpoint like `GET /threads/suggestions` or similar.

### Backend review

Aligned with the frontend on almost everything. Open points where we need the product call:

- **Endpoint shape.** Agree on a dedicated `GET /suggestions/starter` (or `/threads/suggestions`) returning `{suggestions: [{id, text}]}`. Decouples from thread creation so refreshing suggestions doesn't create a thread; also lets us add an analytics id.
- **Count.** Backend is happy to honor whatever count the frontend asks for via `?n=4`. Default 4 matches Open WebUI's pattern.
- **Refresh cadence** (answers the frontend's question): I'd recommend **once per page load, stable within a session**. Rationale: backend will pre-generate a pool of ~30 rephrased prompts at startup and serve a random subset of 4 per request. That gives variety across users without per-click LLM cost, and keeps a single session stable (no "suggestions shuffle" mid-page). Regenerating on every New Thread click would force a stronger cache policy to stay cheap.
- **"Latest" qa collection resolution.** Options:
  - (a) Scan Milvus for collections matching `rag_bot_qa_*` and pick max by timestamp suffix on startup. Automatic, matches rag_bot's ingest cadence.
  - (b) Pin via `SUGGESTIONS_QA_COLLECTION` in Settings. Safer, explicit, survives half-ingested collections.
  - Recommend (a) with a settings override as the escape hatch.
- **Rephrase model.** Propose a new `SUGGEST_LLM` vendor pattern (mirrors `GEN_LLM`) so we can run a cheaper/faster model. Falls back to `GEN_LLM` if unset. One batched call that rephrases N Q&As → N casual prompts.
- **Cache lifecycle.** In-process pool, built on startup, rebuilt on a `POST /admin/suggestions/refresh` dev endpoint when a new ingest lands. No Redis needed at current scale.
- **Source-type awareness.** Today only the `qa` collection has Q&A structure (435 rows); the other three collections (`faguquanji`, `short_story`, `events`) aren't usable sources for starter suggestions. So starter suggestions are effectively global for v1, regardless of `default_source_type`. Flag if that's not acceptable.

Open question for the user:
- **Content filter on the QA pool?** Are there any entries we should skip (off-topic, stale, NSFW)? 435 rows is small enough to eyeball once.

### Frontend follow-up

- Backend proposal looks good to me.
- Frontend preference: `GET /suggestions/starter?n=4` is slightly clearer than hanging this off `/threads`, because these suggestions exist before any thread is created.
- Frontend is happy with "once per page load, stable within a session." That matches the UI expectation better than reshuffling on every `New Thread`.
- Frontend note: if backend can guarantee `{suggestions: [{id, text}]}`, I can keep the rendering layer very simple and reusable with feature 2.
- Frontend agrees that starter suggestions being global for v1 is acceptable. I would not block milestone 1 on source-type awareness.

2. Follow up suggestions: current hehavior: no follow suggestions, goal is to generate follow up suggestion, the ideal behavior should be similar to what open-webui offered.

### Frontend review

- This one is more ambiguous than item 1 and I think we should pin down the UX before implementation.
- Frontend question: when do follow-up suggestions appear?
  - after every assistant answer
  - only when the answer finishes successfully
  - only on assistant answers with citations / grounded retrieval
- Frontend question: should they replace the current welcome suggestions area, appear under the latest assistant message, or appear above the composer as quick-reply chips?
- Frontend preference: render them under the most recent assistant message or just above the composer, not in the sidebar. They are conversational next-steps, not thread metadata.
- Frontend question: are these suggestions generated from the backend answer + history, or from retrieval hits only? This matters because if they are answer-derived, they will feel more coherent with the conversation.
- Frontend comment: if we want something "similar to open-webui", we should keep them lightweight and dismissible. Persistent suggestion clutter after multiple turns will make the thread feel noisy.
- Frontend question: do we want only one generation at a time for the active thread, or should old follow-up suggestions remain attached to older assistant turns in history?
- Frontend recommendation: milestone 1 should probably scope this to "latest turn only" so we do not have to solve historical suggestion state yet.

### Backend review

Aligned with the frontend's "latest turn only" recommendation — solves 90% of the UX with none of the historical-state complexity. Decisions I need from the user:

- **Delivery contract** (three options, pick one):
  - **A. Extend SSE.** New event type `suggestions/final` emitted right after the `values` event on `/threads/{id}/runs/stream`. Frontend gets them in the same connection; no extra round-trip. Small spec addition to the SSE event list.
  - **B. Piggyback on `values`.** Add `suggestions: [...]` to the `values` payload. Simplest diff; couples follow-ups to run completion.
  - **C. Separate endpoint.** `POST /threads/{id}/suggestions/followup` called after the run settles. Cleanest separation but two round-trips per turn and a serial wait.
  - My recommendation: **A**. Keeps the turn to one connection, lets the frontend render the answer first and suggestions when they arrive, no blocking the main answer.
- **Generation input.** Agree with the frontend that these should be **answer + history-derived**, not retrieval-only — they'll feel more coherent. Practically: feed the last assistant answer + last user question into a small "propose 4 follow-ups" prompt.
- **Latency.** One extra LLM call per turn. Options to soften:
  - Fire the follow-up LLM call in parallel with the SSE `values` event emission (so follow-ups arrive ~1s after the answer instead of adding to total time-to-first-answer).
  - Use `SUGGEST_LLM` (cheaper model) if we adopt it for feature 1.
- **Scope gates** (confirm which):
  - All assistant answers, or only grounded ones (i.e. when `citations` is non-empty)? Recommend **only grounded** — avoids showing follow-ups under the "I couldn't find sources" fallback, which has no useful follow-up direction.
  - Skip for `/v1/chat/completions` (OpenAI-compat) — contract doesn't support it cleanly. Confirm that's fine.
- **Shape.** `{suggestions: [{id, text}]}` — same as feature 1 for consistency. Frontend can share rendering.

Open questions for the user:
- **Exactly how many follow-ups?** Open WebUI shows 3. Ours: 3 or 4?
- **Dismissibility persistence.** If a user dismisses a follow-up, do we track that server-side (needs per-user storage) or treat it as purely client-side (frontend state)? Recommend client-side for v1.

### Frontend follow-up

- I agree with backend recommendation **A. Extend SSE**. That is the cleanest frontend integration for the current runtime because follow-ups belong to the same completed turn, but should not block answer rendering.
- Frontend preference on count: **3** follow-ups. That will read cleaner under a message and avoids the area becoming visually heavier than the answer itself.
- Frontend agrees on **client-side dismiss only** for v1.
- Frontend agrees on **grounded answers only** as the first scope gate. Showing follow-ups under "no hits" answers will feel random.
- Frontend note: if we use SSE option A, I would like the event shape to mirror feature 1 exactly, e.g. `event: suggestions/final` with `{"suggestions":[{"id","text"}]}` so I can reuse the same chip component.
- Frontend recommendation: do not persist follow-up suggestions into long-term thread history in v1. Treat them as ephemeral UI attached to the latest turn only.

3. Experimental UI on citations: current havior: we current have a pull down citations, like to try to see the visual from Tool UI, read details from https://www.tool-ui.com/docs/citation?tab=examples&preset=with-actions&view=chat

### Frontend review

- I looked at the Tool UI citation docs. Their citation component is card-oriented and supports default / inline / stacked variants, with optional title, domain, favicon, snippet, author, and published date.
- Frontend comment: our current citations already behave more like a grouped source list than a tool result. So this is likely a visual redesign, not a data-model rewrite.
- Frontend recommendation: for milestone 1, we should avoid introducing Tool UI as a new runtime abstraction unless we also plan to adopt it for more than citations. We can borrow the visual direction without committing to a new component stack immediately.
- Frontend preference: the most promising pattern here is either:
  - inline citation chips near the answer with an expandable stacked list
  - a denser source card list under the assistant answer
- Frontend concern: full citation cards for every source may make grounded answers feel too tall, especially when an answer cites many chunks from the same document.
- Frontend question: do we want the primary object to be the source document or the citation snippet? Right now we group by source and show snippets inside; I think that is the right default for long-form RAG answers.
- Frontend question: should citation clicks open the raw `source_url` directly, or do we expect an internal document viewer route later?
- Frontend question: if a citation has no `source_url`, should we still render it as a visual source card with metadata/snippet, or demote it to plain text attribution?
- Frontend recommendation: before implementing the full Tool UI look, we should agree on one of these target UX shapes:
  - compact accordion with richer cards inside
  - always-visible compact cards
  - inline chips + popover drawer
- Frontend note: because citations only arrive in the final `values` event, any redesigned UI should still tolerate the "appears at end of response" behavior we already fixed.

### Backend review

This is mostly a frontend change. Backend-side concerns and questions:

- **Citation shape sufficiency.** Our current block ([app/rag/protocol.py](../app/rag/protocol.py)) carries `chunk_id, text, title, source_url, score, metadata{source_type, record_id, chunk_index, publish_date}`. Against the Tool UI fields the frontend listed (title, domain, favicon, snippet, author, published date):
  - `title` ✓
  - `snippet` ✓ (`text`)
  - `published_date` ✓ (`metadata.publish_date` — verify the source populates it for `faguquanji`)
  - `domain` — can derive client-side from `source_url`, no backend change needed
  - `favicon` — frontend fetches or backend proxies? Recommend frontend-derived from domain; backend shouldn't grow a favicon service for this.
  - `author` — **not currently in our shape.** If the corpus carries it, we should surface it. Need to check rag_bot's chunk model.
  - → One likely small backend change: add `author: str | None` to `RetrievalHit.metadata` if rag_bot has it. Non-breaking.
- **Inline citation markers.** Tool UI's `with-actions` preset may expect `[1]`, `[2]` inline in the answer text. Today the RAG prompt doesn't ask for them. Options if the chosen UX wants inline markers:
  - Prompt-engineer `generate_answer` in rag_bot to emit `[n]` at citation points. Non-deterministic but cheap.
  - Add a post-process re-grounding node that inserts markers by overlap. More faithful but heavier.
  - Skip inline markers for v1; keep source cards under the answer (matches the frontend's "compact accordion" / "always-visible compact cards" options).
  - My recommendation: **skip inline markers for v1**. Matches frontend's target shapes and avoids a prompt-behavior gamble.
- **OpenAI-compat footer.** If we change the citation block shape, the "Sources:" footer logic at [app/api/openai_compat.py:127-133](../app/api/openai_compat.py#L127-L133) may also need updating. Worth scanning once when we land this.
- **Breaking change or parallel.** The frontend is the only consumer of the `citations` content block today, so iterating on its shape in-place (rather than adding `citations_v2`) is fine as long as frontend ships together. Confirm the same assistant-ui contract is used by mobile-v3 before I change field names.

Open questions for the user:
- Is this meant to ship to end users, or is it an internal experiment? Affects how carefully we guard backward compatibility.
- Which of the frontend's three target UX shapes do you lean toward? That determines whether any backend work is needed beyond the optional `author` field.

### Frontend follow-up

- Backend notes make sense to me.
- Frontend agrees with **skip inline markers for v1**. We already have a stable citations block contract and I would rather improve the source presentation first than introduce `[1]`/`[2]` marker logic.
- Frontend agrees favicon/domain can stay client-derived.
- Frontend note: optional `author` would be nice, but I would not block the UI redesign on it. Title + snippet + source domain is enough for milestone 1.
- Frontend recommendation: target **compact accordion with richer cards inside** first. That is the lowest-risk evolution from the current UI and works well with grouped sources.

---

## Milestone 1 — settled decisions (2026-04-17)

This section is the single source of truth for implementation. Frontend and backend have aligned on all three features. Anything above this section is deliberation; anything below is what's getting built.

### Cross-cutting

- **`SUGGEST_LLM` vendor config.** New env pattern mirrors `GEN_LLM` (e.g. `SUGGEST_LLM=local`, `LOCAL_MODEL=...`). Falls back to `GEN_LLM` when unset so existing deploys keep working.
- **Branch plan.** One bundled branch: `claude/features-v1`. All three features land together.
- **Pool build strategy (feature 1).** Async background task kicked off in FastAPI lifespan. Endpoint serves HTTP `503 Service Unavailable` with `{"status":"warming_up"}` until the pool is ready. Frontend can poll or show a shimmering default until 200 arrives.
- **Admin refresh gate.** `POST /admin/suggestions/refresh` is only mounted when `AUTH_DEV_MODE=true` — same pattern as `/auth/dev-token`. No production exposure.
- **Deferred for post-v1:** `author` in citation metadata (needs rag_bot change); inline `[n]` citation markers; `source_type`-aware starter suggestions; follow-up suggestions on `/v1/chat/completions`; per-user dismiss persistence.

### Feature 1 — starter suggestions

| Decision | Value |
|---|---|
| Endpoint | `GET /suggestions/starter?n=4` |
| Response shape | `{"suggestions": [{"id": "...", "text": "..."}]}` (+ `{"status":"warming_up"}` on 503) |
| Default count | 4 (honor `n` query param, clamp to 1–10) |
| Refresh cadence | Once per page load, stable within session (frontend decision) |
| Source collection | Auto-detect latest `rag_bot_qa_*` by timestamp suffix on startup; override via `SUGGESTIONS_QA_COLLECTION` |
| Pool size | ~30 rephrased prompts; random subset per request |
| Rephrase model | `SUGGEST_LLM` (falls back to `GEN_LLM`) |
| Rephrase style | Casual, first-person, under ~12 words; one batched LLM call |
| Caching | In-process dict, built at startup, rebuilt on `POST /admin/suggestions/refresh` (dev-only) |
| Content filter | None for v1 — corpus trusted as-is |
| Source-type awareness | Global (v1); starter suggestions do not vary by `source_type` |

### Feature 2 — follow-up suggestions

| Decision | Value |
|---|---|
| Delivery | New SSE event `suggestions/final` on `/threads/{id}/runs/stream`, emitted after the `values` event |
| Event data shape | Mirrors feature 1: `{"suggestions":[{"id","text"}]}` |
| Count | 3 follow-ups |
| Scope gate | Only emitted when the assistant reply has non-empty citations (grounded answers only) |
| Generation input | Last user question + last assistant answer (no raw retrieval hits) |
| Model | `SUGGEST_LLM` (falls back to `GEN_LLM`) |
| Latency strategy | LLM call fires in parallel with the `values` event emission so it doesn't extend time-to-first-answer |
| Persistence | Ephemeral — not written into thread checkpointer state |
| Dismiss | Client-side only |
| OpenAI-compat (`/v1/chat/completions`) | Skipped; contract doesn't cleanly support follow-ups |

### Feature 3 — citations UI

| Decision | Value |
|---|---|
| Scope | **Frontend-only** for v1. No backend branch, no citation block shape change. |
| Visual target | Compact accordion with richer cards inside |
| Inline `[n]` markers | Not for v1 |
| Domain / favicon | Client-derived from `source_url` |
| Ship posture | Internal experiment — we can iterate on the citations block shape in-place later without a parallel `citations_v2`, but v1 is pure frontend |
| Follow-up | Before changing the citation block shape (post-v1), confirm `mobile-v3` compatibility |

### SSE event contract addendum (feature 2)

`/threads/{id}/runs/stream` event sequence, updated:

```
messages/partial*    — running accumulation during LLM streaming
messages/complete    — final assistant message text
values               — full normalized thread state
suggestions/final    — NEW. Only emitted when the last assistant turn has citations.
                       data: {"suggestions":[{"id":"...","text":"..."}]}
end                  — sentinel
error                — emitted on exception before end
```

Frontend implication: parse `suggestions/final` as an independent event type; it can arrive up to ~1s after `values`. Absence of `suggestions/final` (e.g. under a no-hits answer) is expected, not an error.
