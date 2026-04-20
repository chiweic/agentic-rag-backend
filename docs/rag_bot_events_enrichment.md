# rag_bot follow-up: enrich the `events` corpus with registration + contact details

Filed from `backend-v2` on 2026-04-20 after shipping the `/events`
recommendations tab on branch `claude/v2-feature-2-deep-dive`.

## Problem

On backend-v2's `/events` tab, the LLM has access to the `events` corpus (source_type `events`, latest manifest version `20260412T171218.446756Z`). It answers title / date / topic questions well. It fails on the two most likely user follow-ups:

- **Registration**: "如何報名臺中寶雲寺的課程？" — LLM correctly refuses; says the provided text only instructs "報名請洽寶雲寺知客處" and has no URL, phone, or form.
- **Contact**: "寶雲寺知客處的聯絡電話是多少？" — same. The contact phone is on ddm.org.tw but isn't in the indexed chunks.

The backend-v2 generation prompt is working exactly as intended (grounded answers, no hallucination). The fix belongs in the content pipeline.

## Concrete example

An event record like "快樂學佛人(三次課程) · 臺中寶雲寺" gets chunked with:

- `title` — event title ✓
- `publish_date` — date ✓
- `body` — event description, which ends with "報名請洽寶雲寺知客處" (no number, no URL)
- `source_url` — the ddm.org.tw page ✓
- `metadata.book_title` / `chapter_title` / `category` — varies

What's **not** in the chunk:

- The registration URL / form (even though ddm.org.tw has one)
- The venue's phone number (知客處)
- The venue's address beyond city name
- Organizer specificity beyond "法鼓山"

## What to add

Two options, lowest-to-highest structural change:

### Option A (minimum, recommended) — enrich the chunk body text

No schema change; retrieval + generation work as-is.

For each event, append a "聯絡與報名資訊" section to the body text if missing, populated from the event page:

```
聯絡與報名資訊:
- 地點: 臺中寶雲寺
- 地址: 407 台中市西屯區市政路 37 號
- 電話: (04) xxxx-xxxx
- 報名方式: <URL or phone or specific knowledge-desk hours>
- 主辦單位: <specific branch>
```

When the scraper can't find a field on the page, **omit the line** (don't emit "N/A" — it pollutes retrieval).

### Option B (cleaner, optional) — add structured metadata fields

Per-chunk fields:

- `registration_url: str | None`
- `contact_phone: str | None`
- `venue_address: str | None`
- `organizer: str | None`

These are nice for future consumers (e.g. rendering a "Register" CTA button directly on a card, bypassing the LLM), but they don't automatically help the LLM unless either (a) the generator is changed to include them in the prompt context, or (b) Option A is also done so the text body surfaces them.

**If only doing one, do Option A.**

## Acceptance criteria

After rag_bot re-indexes the events corpus:

1. `rag_service.search("寶雲寺 報名", source_type="events")` returns chunks whose body includes the registration hint + contact number (if the event page has them).
2. Asking "寶雲寺知客處的聯絡電話？" on `/events` returns the actual number, not "未提供".
3. Events that genuinely lack registration info (e.g. walk-ins) still work — no fabricated placeholder text.

## Non-goals (don't change)

- The retrieval protocol (`RagService.search`, `get_record_chunks`) — it already works once chunks are richer.
- The backend-v2 `_generate_scoped` prompt — it's corpus-agnostic, no events-specific tuning needed.
- The chunk schema's core fields (`title`, `source_url`, `publish_date`) — only add, don't rename.

## File touchpoints (best-guess in rag_bot)

- The events crawler / normalizer (wherever the ingest for ddm.org.tw event pages lives). This is where body enrichment happens.
- The events manifest version bumps when you re-index, so the events collection in Milvus (`rag_bot_events_<timestamp>`) gets a new collection and the manager auto-picks the latest. No code change needed on the backend-v2 side once the new manifest is published.

## Verification from backend-v2 after the fix lands

Two queries on the `/events` tab:

1. "如何報名臺中寶雲寺的課程？" — expect a concrete answer citing the enriched chunk (URL or phone).
2. "寶雲寺知客處的聯絡電話是多少？" — expect the real number, not "未提供".

No backend-v2 code changes expected.
