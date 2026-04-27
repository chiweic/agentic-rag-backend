v2 features:

1. finetune on citations UI: experimenting with how citations UX. to start with example: 
import { CitationList } from "@/components/tool-ui/citation"

<CitationList
  id="citation-list"
  citations={citations}
  variant="stacked"
/>

2. Experimenting using the "AssistantSidebar" to apply action from click citation. So we are adding an action "Deep dive" to open an AssistantSidebar that the left side is the source content, and the right side present a Thread chat. see https://www.assistant-ui.com/docs/ui/assistant-sidebar for more example/details.

3. quiz generation based on source content. It begin ny using th preferences panel (https://www.tool-ui.com/docs/preferences-panel) UI to adjust "Easy quiz", "Enable essay". And then use question-flow UI (https://www.tool-ui.com/docs/question-flow) to render quiz generated.

4. Application-level tabs. The current chat becomes the default "chat" tab, and we add an "event recommendations" tab. A third "what's happening now" tab is deferred to a later milestone (see below for why).

### 4a. Event recommendations (in scope for this milestone)

Goal: given what the user has been asking about lately, surface live events from DDM they might want to attend.

Pieces, each shippable independently:

- **`events` corpus** — assumed already indexed in rag_bot today; needs verification before the endpoint ships. If missing, that's an upstream rag_bot ingest job, not a backend-v2 task. Our `RagService.search(source_type="events", ...)` path already supports a source-type swap for free.
- **Recent-query summary service** — an LLM call that reads the user's last-7-days user-turn texts from Postgres and emits a short interest profile. Recompute on each tab visit for the MVP (no caching) — simpler and the LLM cost is bounded. The 7-day window becomes a setting so we can tune later.
- **Recommendation endpoint** — `POST /api/recommendations` (or GET with cached profile). v1 is literally `rag_service.search(interest_profile, source_type="events", limit=N)`, returning hit cards. Swap behind the same endpoint if we later want a proper recommendation API (collaborative / embedding-based).
- **UI** — card grid on the `/events` route. Each card: event title, date, location, "register" / "learn more" CTA backed by `source_url`.

Sequencing:
1. Tab shell — top-nav + Next.js app-router segments (`/` for chat, `/events` for recommendations). Chat stays the default; sidebar only renders on the chat tab.
2. Recent-query summary service + `/api/recommendations` endpoint (backend).
3. Event recommendations UI (frontend).
4. Re-evaluate next steps after seeing 1–3 used in production.

### 4b. What's happening now (deferred)

Originally scoped as a tab aggregating real-time external news feeds, internal news, and internal magazine content — each source needing its own ingest pipeline. Multi-week effort before the UI layer even matters, and the "tab" framing is itself uncertain (ambient "what's new" content usually works better as a pre-chat banner or home panel than as a destination a user deliberately navigates to).

Deferred until event recommendations has shipped and we've seen how users actually engage with it. If this revives, the first decision is UI surface (tab vs. banner vs. widget), not ingest.