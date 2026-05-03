Version 6: Unified conversation (no tabs, multi-corpus retrieval)

## Goal

Replace the four-tab structure (default chat / `/events` / `/sheng-yen` / `/whats-new`) with **one conversation surface** where the system intelligently routes each turn to the right corpus, and the content currently siloed behind tabs surfaces itself as **follow-up chips** mid-conversation.

User mental model becomes: "I just chat. The system finds relevant material — events, books, audio, video, news — and offers me what to dig into next."

Tabs as a navigation primitive go away on this surface. Their content lives on inside the corpus and re-surfaces contextually.

## User feedback motivating this

Existing tabs (`/events`, `/sheng-yen`, `/whats-new`) need explanation to use — users land on them and don't know what they're for. Two suggestions emerged:

1. Use starter pills on the welcome page (concrete example queries) — more self-explanatory than tab labels.
2. But starter pills lead users into "scoped" pages where the UX of switching scope back/forward isn't transparent.

Direct fix to (1) without addressing (2) just moves the confusion. The decision is to attack the underlying assumption — that scope must be a thread-level mode the user manages — and replace it with per-turn routing the system handles.

## Decisions (committed)

1. **Single conversation thread per user goal, no tabs.** Multi-hop chats can naturally cross corpora within one thread.
2. **Composer stays at the bottom**, standard chat layout. Suggestions block sits above the composer on the welcome screen; replaced by the running message stream once the user sends.
3. **Scope is per-turn, not per-thread.** Default `Auto` for every turn; the user can manually override per turn via a small chip near the composer.
4. **Unified-collection retrieval, not router-first or fan-out.** ⭐ Updated 2026-05-03 after Stage 2d: instead of fan-out across 11 per-source collections + rerank-across-union, all 39k chunks live in one Milvus collection (`rag_bot_unified_<ts>`); a single nearest-neighbor search returns top-K (50), reranker truncates to top-N (5). Empirically 2.4× faster than fan_out @10 with comparable or slightly-better quality (Stage 2d numbers). The 📍 chip label is *derived* from what the LLM cited (the dominant `source_type` in the citations), not predicted before.
5. **Tab content reappears as follow-up chips.** The audio/video player, events cards, news headlines that today live on `/sheng-yen`, `/events`, `/whats-new` get promoted into the follow-up area below each assistant turn — richer than today's text-only `suggestions/final` chips. Tap → media plays in-place / event card opens / news scoped query sends.
6. **Starter pills on welcome are LLM-generated, refreshed daily.** A cron job per corpus produces 3 example queries; frontend fetches once on welcome-page load.
7. **No confidence percentage shown to users.** "78%" is jargon. If we need to express uncertainty, use verbal labels (`📍 likely events`), visual styling, or a "wasn't quite right? try as Sheng-yen" alternative chip.
8. **Tabs hidden, not removed.** `/events`, `/sheng-yen`, `/whats-new` URLs and pages stay alive in code so we can A/B and roll back. Just removed from primary nav. Hard-delete after the new model proves out.
9. **Desktop first, mobile follows.** Target: 100% feature parity on desktop, ~80% on mobile (drops the manual scope-override dropdown and rich media chips initially) while keeping the UX consistent.

## Layout (desktop welcome page)

```
┌─────────────────────────────────────────┐
│         今天想問什麼?                    │
│         帶點禪味的 AI                    │
│                                         │
│  [composer text input]      [send]      │  ← bottom
│  Auto ▾                                 │  ← scope chip; default Auto
│  [活動推薦] [聖嚴聲影] [時事禪心]          │  ← category pills
│  [台北下週 5/1 的禪修活動]                │  ← LLM-generated starter, daily refresh
│  [...starter 2 for selected category]   │
│  [...starter 3 for selected category]   │
└─────────────────────────────────────────┘
```

After first send, the suggestions block disappears; replaced by the message stream. Follow-up chips appear under each assistant turn.

## Open questions (not yet decided)

- Default category pre-selected on welcome load? (Probably "活動推薦" as it's the most time-sensitive.)
- ~~Multi-corpus retrieval blends well, or do we need per-corpus weighting?~~ — **resolved Stage 2d**: unified retrieval blends well; no per-corpus weighting / MMR / quotas needed. Reranker handles corpus-appropriateness automatically.
- Anaphora resolution ("tell me more about that") in multi-hop multi-corpus threads — how aggressively should retrieve bias toward recently-cited corpora?
- Re-ingest pattern when one corpus updates: full unified rebuild (~100 s for 40k chunks) vs in-place delete-and-insert vs keep-per-source-and-sync. Likely answer: keep per-source as source of truth + sync to unified during transition; full-rebuild long-term.
- `multi_search` API shape on the protocol: `multi_search(query, source_types=None, limit=5)` likely; settled at Phase 0d wiring time.
- Mobile manual-override UX — is the dropdown worth the chrome or do we ship Auto-only on mobile?

## Backend changes required

| Change | Complexity | Notes |
|---|---|---|
| Multi-corpus retrieval in `retrieve` node | S/M | When `metadata.source_type` is absent or `auto`, parallel search across all corpora, merge, rerank. ~30 lines in [app/agent/nodes.py](/mnt/data/backend/app/agent/nodes.py) + adapter changes in [app/rag/providers/rag_bot.py](/mnt/data/backend/app/rag/providers/rag_bot.py). |
| Per-turn scope state | S | `AgentState.source_type` exists; just becomes per-turn input rather than thread-global. |
| Citation-derived chip label | S | After generation, look at `source_type` distribution of cited chunks; dominant becomes the chip label. ~20 lines. |
| Rich follow-up chip payload | M | Today's `suggestions/final` SSE event is `[{id, text}]`. Extend to `[{id, label, type: "query"\|"media"\|"card", payload: {...}, action: "send"\|"open"}]`. Backend picks 1–2 cross-corpus content recommendations using embedding similarity on welcome-card content. Frontend opts in to rich rendering; old clients still see text-only chips. |
| Daily-refreshed starter pills | S | Cron job calls LLM per corpus: "3 question prompts about recent content." Persist to Postgres. New endpoint `GET /api/starters?corpus=<x>`. |
| Multi-hop anaphora | M/H | Make-or-break for "feels like one conversation." Retrieve node biases toward recently-cited corpora when a query is anaphoric. Defer to a second iteration once basic flow works. |
| Latency | Risk | Multi-corpus = N parallel retrieval calls + rerank across N×K candidates. Estimate +200–500ms per turn. Measure with [app/core/tracing.py](/mnt/data/backend/app/core/tracing.py)'s Langfuse spans. |
| Relevance quality | Risk | Multi-corpus blending may regress single-corpus accuracy. Required gate: existing per-corpus eval suites must not regress significantly (definition: see Experiment plan below). |

Total lift estimate: **2–3 weeks backend** for usable prototype, **+1–2 weeks** for evaluation tuning.

## Experiment plan: does multi-corpus retrieval actually work?

The big risk is relevance regression. **Most of the foundation is already in place** — see `/mnt/data/rag_bot/docs/benchmark_notes.md` "Per-source Scoped Retrieval Baseline (2026-05-03)" for the existing measurements. The remaining work is the multi-corpus comparison itself plus a small cross-corpus addition.

### Stage 0 — eval data (DONE — confirm before reusing)

Already in place at `/mnt/data/rag_bot/data/eval/<source>_deepseek.jsonl`:

- All 11 corpora covered, 100 cases each = 1,100 cases total
- Generated via `rag-bot-eval-gen --mode deepeval --randomize-contexts`
- Synthesis LLM = DeepSeek-chat (different from generation LLM, no self-grading bias)
- Schema: `{query, source_type, expected_chunk_ids, expected_output}` consistent across files
- Treat as frozen for this experiment; do not regenerate unless we change synthesis methodology

### Stage 1 — single-corpus baseline (DONE — published)

The "upper bound for routing" is already measured and tabulated in `benchmark_notes.md` for HNSW+COSINE / `bge-m3` embedder / optional `bge-reranker-large`:

| | hit_rate | MRR |
|---|---|---|
| avg across 11 corpora, no rerank | **0.90** | **0.760** |
| avg across 11 corpora, rerank k=10 | **0.89** | **0.817** |

Worst per-source: `magazine 0.82` (PDF-OCR / layout artifacts). Trivial-easy: `qa 1.00`, `venues 0.99` (synthesizer used the same chunk that anchored the query). p50 retrieval latency 7–12 ms unranked, 34–92 ms with rerank `k=10`.

Per-source per-config artifacts at `tmp/eval_baseline/<src>_<cfg>.{log,json}`. These numbers become the floor for the multi-corpus experiment.

### Stage 2 — multi-corpus retrieval (the actual experiment)

Same 11 eval files, retrieve with `source_type=None` so the system must look across all corpora. Per-corpus `K_per_corpus` × 11 candidates → rerank → top-N. Capture:

- `hit_rate` and `MRR` per source (compare to the 2026-05-03 published numbers)
- `dominant_cited_corpus` — does the top hit's `source_type` match the eval row's `source_type`? This is the implicit "router accuracy" of multi-corpus.
- `expected_chunks_in_topN` — citation-recall preservation (with 11× more candidates competing for top-N, do the right chunks still surface?)
- `latency_p50` / `latency_p95` — multi-corpus retrieval is N parallel calls + a wider rerank pool. Expected delta: +200–500 ms.

Acceptance criteria (proposed; tune after first run):

| Metric | Per-source acceptance | Average acceptance |
|---|---|---|
| `hit_rate` | within 0.05 of scoped baseline | within 0.03 of scoped average |
| `MRR` | within 0.05 of scoped baseline | within 0.03 of scoped average |
| `dominant_cited_corpus` accuracy | n/a (per-source) | ≥ 0.85 across all corpora on clear single-corpus queries |
| `latency_p95` | < 5 seconds end-to-end through generation | n/a |
| `judge_score` (DeepEval 4 metrics) | within 5% of scoped baseline | within 2% on each metric |

Tooling: **`rag-bot-eval` already supports multi-corpus** via `--strategies scoped,fan_out` — no new CLI needed. The `cross_source_search` function in [rag/sources.py](/mnt/data/rag_bot/src/rag_bot/rag/sources.py) does per-source retrieval with `rerank=False`, unions the results, and runs one global rerank with `top_n` overridden to `len(combined)`. Driver loop:

```bash
for src in qa venues events video_ddmtv01 short_story audio video_ddmtv02 \
           video_ddmmedia1321 news faguquanji magazine; do
  rag-bot-eval --input data/eval/${src}_deepseek.jsonl \
    --backend milvus --limit 5 --rerank \
    --strategies scoped,fan_out \
    --output tmp/eval_v6_full/${src}.jsonl
done
```

Wall clock ~30 min total (~2.5 min per source).

### Stage 2 — initial run (2026-05-03)

Per-source results, default settings (`per_source_limit=20`, `final_limit=5`, `rerank=True`, candidate pool of 220):

| corpus | sc.hit | sc.MRR | fan.hit | fan.MRR | Δhit | ΔMRR | route | sc lat (ms) | fan lat (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| qa | 1.00 | 0.938 | 0.95 | 0.783 | -0.05 | -0.156 | 0.98 | 77 | 1557 |
| venues | 0.97 | 0.965 | 0.96 | 0.943 | -0.01 | -0.022 | 0.97 | 36 | 1452 |
| events | 0.90 | 0.723 | 0.90 | 0.715 | 0.00 | -0.008 | 1.00 | 46 | 1473 |
| video_ddmtv01 | 0.95 | 0.866 | 0.90 | 0.742 | -0.05 | -0.124 | 0.99 | 92 | 1548 |
| short_story | 0.89 | 0.853 | 0.87 | 0.811 | -0.02 | -0.042 | 0.95 | 81 | 1546 |
| audio | 0.87 | 0.779 | 0.81 | 0.668 | **-0.06** | -0.111 | 0.94 | 91 | 1554 |
| video_ddmtv02 | 0.87 | 0.791 | 0.84 | 0.704 | -0.03 | -0.087 | 0.94 | 91 | 1564 |
| video_ddmmedia1321 | 0.81 | 0.737 | 0.78 | 0.590 | -0.03 | -0.147 | 0.93 | 93 | 1550 |
| **news** | 0.86 | 0.828 | **0.89** | 0.817 | **+0.03** | -0.011 | 0.98 | 77 | 1530 |
| faguquanji | 0.82 | 0.761 | 0.82 | 0.753 | 0.00 | -0.008 | 0.99 | 86 | 1556 |
| magazine | 0.81 | 0.750 | 0.79 | 0.692 | -0.02 | -0.058 | 0.93 | 88 | 1530 |
| **avg (11)** | **0.89** | **0.817** | **0.86** | **0.747** | **-0.02** | **-0.070** | **0.96** | **78** | **1533** |

#### Verdict against the acceptance criteria

| Metric | Result | Bar | Verdict |
|---|---|---|---|
| Average `hit_rate` Δ | -0.02 | within 0.03 | ✅ |
| Worst-source `hit_rate` Δ (audio) | -0.06 | within 0.05 | ❌ slightly over |
| Average `MRR` Δ | -0.070 | within 0.03 | ❌ |
| Worst-source `MRR` Δ (qa) | -0.156 | within 0.05 | ❌ way over |
| Average `routing_correctness` | 0.96 | ≥ 0.85 | ✅ comfortable |
| Latency p50 (retrieval only) | 1533 ms | < 5 s end-to-end | ⚠️ +LLM ≈ 3.5–5.5 s |

#### Pattern findings

1. **Three corpora barely degraded** (Δhit ~0, ΔMRR < 0.01): `events`, `faguquanji`, `news`. These have **distinctive content** — venue names + dates (events), book/chapter structure (faguquanji), date-tagged headlines (news). Distinctive content survives multi-corpus blending.
2. **News actually IMPROVED on hit_rate (+0.03)**. Plausible interpretation: news headlines reference dharma concepts that other corpora explain in detail; the reranker exploits the cross-corpus context. This is a real cross-corpus win, not a sampling fluke — worth examining individual cases to confirm.
3. **The penalized corpora share a property**: Q&A-style or talking-head transcripts (`qa`, `audio`, `video_ddmtv01`, `video_ddmmedia1321`) where content overlaps semantically with all other dharma corpora. The reranker can't reliably pick "the right `qa` chunk" when 10 other corpora carry similar-sounding answers.
4. **Routing accuracy is genuinely strong** (0.93–1.00 across all corpora). The dominant-cited-corpus chip label will be right almost always — the chip-label UX is the safest piece of the magic-wand vision.
5. **Latency is dominated by the rerank pool size** (220 candidates × ~7 ms = ~1500 ms), not the per-source Milvus calls (~5–10 ms each). Per-source latency is fine; rerank pool is the cost driver.

#### Read

The proposal as currently shaped trades **2 hit-rate points and 7 MRR points on average** for the magic-wand UX — and the trade is **not uniform** across corpora. Some corpora gain, several barely move, a few lose meaningfully. Latency is the bigger issue: 1.5 s of pure retrieval before the LLM even starts is not shippable as-is.

#### Next steps

1. **Stage 2b — sweep `per_source_limit` (10, 5)** to map quality vs latency.
2. **Stage 2c — case-level inspection** + investigate latency lever (TEI server tuning).
3. **Stage 2d — try a unified-index alternative** (one Milvus collection holds all 11 corpora's chunks; query once, no fan-out).
4. **Stage 3 — cross-corpus eval** becomes more important.
5. **Phase 0d wiring** is gated on a satisfactory Stage 2b/c/d outcome.

### Stage 2b — `per_source_limit=10` sweep (2026-05-03)

Same eval files, same fan_out path, but per_source_limit dropped from 20 → 10 (110 candidates → rerank). Aggregated:

| | avg hit | avg MRR | avg routing | avg p50 lat |
|---|---|---|---|---|
| scoped (control) | 0.89 | 0.817 | 1.00 | 78 ms |
| fan_out @20 (Stage 2) | 0.86 | 0.747 | 0.96 | 1533 ms |
| **fan_out @10** | **0.85** | **0.742** | **0.96** | **794 ms** |

vs @20: avg Δhit -0.01, avg ΔMRR -0.005, **latency -48%**. The "smaller pool reduces noise" hypothesis paid off — quality essentially preserved while latency halved. Per-corpus pattern: 3 corpora improved or held vs @20, 4 dropped 1-2 points, 1 dropped 3 (`video_ddmmedia1321`). Worst per-source vs scoped baseline: -0.06 hit (audio).

### Stage 2c — latency lever investigation (TEI tuning)

Tried two server-side bumps to see if rerank latency could drop further:

1. **`--max-batch-tokens` 16384 → 32768** (let TEI pack more pairs per GPU forward pass)
2. **`--max-client-batch-size` 128 → 256** (let a single 220-pair request fit in one HTTP call)
3. **Client-side parallelisation** added to `rag_bot.rerank.rerank_hits` via `ThreadPoolExecutor` so the per-batch HTTP calls fan out

Combined re-run on venues: **fan_out latency 1424 ms** (vs 1446 ms baseline — within noise).

**Conclusion**: TEI is **GPU compute-bound on real-chunk token count**, not on packing efficiency. ~220 candidates × ~400 tokens ≈ 88,000 token-positions of forward-pass compute regardless of batch shape. The 5060 Ti's bge-reranker-large fp16 throughput is the floor; reshuffling pairs across HTTP requests doesn't change total compute.

This **rules out tuning** as a path to dramatically faster fan_out. The remaining levers all reduce *pairs*: per_source_limit (Stage 2b — done), input truncation (`truncate_chars` — not pursued; quality risk), or smaller reranker model (deferred). The parallelisation change in `rerank.py` stays in — harmless, helps in scenarios where TEI isn't saturated (shorter chunks, multiple GPUs).

### Stage 2d — unified-index alternative (2026-05-03) ⭐

Built a single Milvus collection (`rag_bot_unified_<ts>`) holding all 39,886 chunks from the 11 per-source collections. Same schema (already unified across corpora — corpus-specific fields like `playback_url`, `start_s` are just empty strings on text rows). Same HNSW + COSINE index params as production (M=16, efConstruction=200). Migration script at [tmp/eval_v6_unified/build_unified_collection.py](/mnt/data/rag_bot/tmp/eval_v6_unified/build_unified_collection.py); ~100 s end-to-end (insert + index + load).

Eval pattern: query → embed → search unified (top-50) → rerank → top-5. Custom eval script at [tmp/eval_v6_unified/eval_unified.py](/mnt/data/rag_bot/tmp/eval_v6_unified/eval_unified.py) (eval_cli's strategies don't include unified; we score independently using the same hit_rate/MRR/routing definitions as eval_cli for direct comparability).

Per-source results, top-K=50 + rerank:

| corpus | scoped hit | fan_out @10 hit | unified hit | Δ vs @10 |
|---|---|---|---|---|
| **short_story** | 0.89 | 0.85 | **0.91** | **+0.06** |
| **faguquanji** | 0.82 | 0.80 | **0.86** | **+0.06** |
| **news** | 0.86 | 0.86 | **0.90** | **+0.04** |
| video_ddmtv02 | 0.87 | 0.83 | 0.86 | +0.03 |
| magazine | 0.81 | 0.76 | 0.79 | +0.03 |
| events | 0.90 | 0.89 | 0.90 | +0.01 |
| venues | 0.97 | 0.96 | 0.96 | 0.00 |
| video_ddmmedia1321 | 0.81 | 0.75 | 0.74 | -0.01 |
| video_ddmtv01 | 0.95 | 0.91 | 0.89 | -0.02 |
| qa | 1.00 | 0.95 | 0.92 | -0.03 |
| audio | 0.87 | 0.81 | 0.77 | -0.04 |
| **avg** | **0.89** | **0.85** | **0.86** | **+0.01** |

Aggregated:

| | avg hit | avg MRR | avg routing | avg p50 lat |
|---|---|---|---|---|
| scoped (control) | 0.89 | 0.817 | 1.00 | 78 ms |
| fan_out @20 | 0.86 | 0.747 | 0.96 | 1533 ms |
| fan_out @10 | 0.85 | 0.742 | 0.96 | 794 ms |
| **unified (top-50 + rerank)** | **0.86** | **0.746** | **0.95** | **333 ms** |

**Unified beats fan_out @10 on every dimension**: same/slightly-better quality, **2.4× faster latency**, routing accuracy essentially unchanged. Six corpora improved over @10, four dropped slightly, one tied. Distinctive-content corpora (faguquanji, news, short_story) gain the most — Milvus's nearest-neighbor finds the exact relevant chunks across the whole corpus better than per-source-then-merge. Generic talking-head transcripts (audio, video_ddmtv01) dip slightly because they semantically overlap with the larger faguquanji pool.

### Stage 2e — Pattern A (LLM weaving) empirical validation

The fan_out / unified data showed *retrieval* works. The remaining concern was *generation*: would the LLM produce coherent answers from mixed-corpus citations, or would it scatter? Tested on 3 faguquanji + 3 events queries from the eval set, comparing scoped (today) vs unified retrieval through the same generate path:

| query | scoped citations | unified citations | answer quality |
|---|---|---|---|
| faguquanji #0 (默照禪 vs 公案禪) | 5/5 faguquanji | 5/5 faguquanji **(identical)** | Identical answer |
| faguquanji #25 (固守錯誤信念) | 5/5 faguquanji | 3 faguquanji + 2 short_story | Unified slightly richer — short_story adds practitioner framing |
| faguquanji #50 (聆聽溪流) | 5/5 faguquanji | 2 short_story + 2 faguquanji + 1 magazine | Both correct; unified uses "耳根圓通法門" framing from short_story |
| events #0 (南投德華寺 法會) | 5/5 events | 4 events + 1 **venues** | **Unified is measurably better** — pulled venue contact info (電話, 報名網址, Email) that scoped missed entirely |
| events #25 (中壢 親子教養) | 5/5 events | 5/5 events (identical) | Identical |
| events #50 (林口快樂學佛人) | 5/5 events | 5/5 events | Identical |

**Verdict on Pattern A**: The LLM (Qwen 9B) handles mixed citations gracefully — none of the failure modes I worried about (awkward genre-switching, hallucinated linking, intent inversion) materialised. Cross-corpus mix is **additive, not contradictory**. The events #0 case shows the magic-wand value concretely: today's scoped retrieval can't include venues; unified gives it for free, and the answer is better as a result.

### Stage 2f — ambiguous bare-noun query behavior

The honest worry case was bare-noun queries that span concept + activity. Tested 8 practice-name queries against unified to see how often event-corpora actually contaminate top-5:

| query | event-like in top-5 |
|---|---|
| 念佛, 拜佛, 持咒, 法會, 禪七, 共修 | 0/5 |
| 打坐 | 1/5 (magazine — practitioner article) |
| 朝山 | 2/5 (events + news — both legitimately relevant; 朝山 IS an annual 法鼓山 event) |
| (also tested: 禪修) | 1/5 (news article about an upcoming online retreat) |

Pattern: only practice-names that are **also prominent ongoing 法鼓山 event series** show event-like citations (禪修, 朝山, 打坐). Ran the worst three through full Pattern A generation:

- **禪修**: LLM extracted only the conceptual content from the news chunk ("禪修 is the method/process of relaxation"); did not transcribe the event date / registration. Clean 4-section concept explanation.
- **朝山**: LLM **sectioned the answer naturally** — concept (purpose, methods, meaning) for sections 1-3, then practical access ("you can join via these branches") in section 4. Did not dump raw dates. Pattern D-lite happening for free without any sectioning prompt.
- **打坐**: pure doctrinal answer; magazine + short_story chunks blended in seamlessly as supporting practitioner context.

**Conclusion**: Pattern A is decisively the right default. Three layers of defense work together — (1) reranker filters most event-like chunks from doctrinal-query top-5, (2) when mixed citations DO occur the LLM exercises good editorial judgment, (3) Phase 3 follow-up chips will later handle explicit alt-intent redirection for the rare case where dominant interpretation diverges from user intent.

### Stage 2g — real-user query smoke (incl. simplified Chinese)

Real user queries against unified retrieval, including simplified-Chinese inputs:

| query | top-5 source mix | answer quality |
|---|---|---|
| 禅那是什么意思？(simplified) | qa + 2 faguquanji + 2 video — pure doctrinal | Concise 4-point definition; output in Traditional Chinese (per `_LANGUAGE_PROMPT_PREFIX`) |
| 心外无事是什么意思？(simplified) | 4 faguquanji + 1 video — all from a single 法鼓全集 essay literally titled "事與心" | Direct, well-grounded; cites canonical sources |

Two operational confirmations from real-user tests:

- **bge-m3 cross-script matching works without preprocessing.** Simplified-Chinese queries match Traditional-Chinese corpora natively. No transliteration layer needed.
- **Output language pinning works.** The `Respond in Traditional Chinese` prompt prefix in `app/rag/providers/rag_bot.py` keeps output in zh-TW even when input is zh-CN. Mainland users ask in simplified, get clean traditional answers.

### Stage 2 — final verdict

Path forward: **ship unified retrieval, top-K=50, rerank to top-5, Pattern A generation (no special prompting)**. Acceptance criteria proposed at the start of Stage 2 were calibrated against fan_out's expected behavior; with unified the trade is much more favorable:

| Metric | Original target | Unified result | Verdict |
|---|---|---|---|
| Per-source `hit_rate` | within 0.05 of scoped | worst -0.04 (audio); 6/11 *improved* | ✅ |
| Per-source `MRR` | within 0.05 of scoped | varies; same direction as hit_rate | ✅ on average |
| Routing accuracy avg | ≥ 0.85 | 0.95 | ✅ |
| Latency p50 (retrieval) | < 5 s end-to-end | 333 ms | ✅✅ |

### Stage 3 — cross-corpus eval (new, ~50 hand-crafted cases)

Existing eval files don't cover queries that legitimately span corpora. Manually construct ~50 queries:

- "聖嚴法師對禪修活動的看法" — sheng-yen + events
- "近期災難相關的禪修活動" — news + events
- "聖嚴法師談時事禪心" — sheng-yen + news
- "短篇故事中的禪修智慧" — short_story + qa

For each: subjective judge (human or LLM) on whether the multi-corpus answer is *better* or *comparable* to the best single-corpus alternative. No quantitative gate; this is qualitative confidence.

### Stage 4 — chip-label sanity

Take 100 mixed queries (50 from existing eval files + 25 from Stage 3 + 25 free-form ad-hoc). Run through multi-corpus path. Eyeball whether the chip label matches what a human would expect:

- Clear single-corpus query → label should match the obvious corpus
- Ambiguous query → label should be one of the plausible corpora
- Cross-corpus query → label should reflect the dominant corpus or "mixed"

### Stage 5 — live A/B

Once offline metrics pass, ship behind a feature flag. Random 10% of users get the unified-conversation path. Compare engagement metrics over a 1-week window:

- Messages per session
- Session length (turns)
- Follow-up chip tap rate
- Retention (return within 7 days)
- Explicit thumbs-down rate (if/when we add ratings)

Ramp 10% → 50% → 100% gated on no significant regression.

### Tooling already in place — just extend

| CLI / harness | What it does | Status |
|---|---|---|
| `rag-bot-eval-gen` | Synthesize eval cases per source via DeepSeek | ✅ Used to produce the existing 11 eval files |
| `rag-bot-search-bench` | Warm-state retrieval benchmark, hit_rate / MRR / latency | ✅ Used for the published 2026-05-03 baseline |
| `rag-bot-gen-eval` | End-to-end DeepEval scoring with retrieval + generation + judge | ✅ Phase-1 generation eval |
| `rag-bot-judge-smoke` / `rag-bot-judge-native-smoke` | Judge LLM debugging | ✅ For investigating individual cases |
| **(new) `rag-bot-search-bench --multi-corpus`** | Same as scoped search-bench but retrieves from all corpora simultaneously | ⬜ Add; ~100 LOC change to existing CLI |

Avoid building a separate eval harness in `backend/`. The rag_bot tooling is in-process (fast), already wired to the eval-file format, and persists per-case for replay. Extending it is cheaper than reproducing it.

## Citation / sources design

The citation pills under each assistant message are the **primary surface for trust and depth-exploration**. Users tap them when they want to verify an answer or dig deeper. With unified retrieval, the citation set now mixes 11 corpus types, each carrying different metadata.

### Per-corpus metadata reality

The backend Citation shape is generic, but the data is non-uniform. Each corpus carries different distinctive fields that a card *should* render:

| corpus | distinctive fields | what a card should show |
|---|---|---|
| `faguquanji` | book_title, chapter_title, attribution | 《book · chapter》, by author |
| `qa` | title, source_url | the question + 1-line snippet |
| `events` | venue_name, publish_date, source_url (registration) | title, venue, date range, [報名] button |
| `news` | publish_date, source_url | title, date, [閱讀全文] |
| `audio` | series_name, unit_name, playback_url, duration_s, start_s, end_s | series · unit, [▶ 5:32 / 18:00] inline player |
| `video_*` | series_name, unit_name, playback_url, start_s, end_s | series · unit, [▶ open at 2:15] |
| `venues` | venue_name, address, phone, source_url | venue card with map link, phone tap-to-call |
| `magazine` | title, publish_date, source_url (PDF) | title, issue/date, [PDF] |
| `short_story` | title, attribution | title, by author |

### Card type — adaptive vs uniform vs dual

| Approach | What | Tradeoffs |
|---|---|---|
| **Uniform** (mobile-web today) | Same pill shape for all corpora; just label + icon | Simple; fits any screen; loses type-specific affordances |
| **Adaptive** | Different visual per corpus type | Best UX; matches user mental model; significantly more component code |
| **Dual** (desktop today) | Unified card chrome, type-specific inner content | Compromise; chrome consistent, content adapts |

**Decision**: **Dual on desktop, uniform on mobile-web.** Desktop has the screen real estate for type-specific affordances (audio scrubber, event card with map). Mobile keeps the pill format but adds a small type-icon prefix: `📚 faguquanji ·…`, `📅 events ·…`, `▶ audio ·…`. Tapping a mobile pill opens the source URL; desktop opens type-specific UI.

### Click destination — type-driven

| Source type | Click action |
|---|---|
| audio / video_* | Inline player (don't lose chat context) |
| events / news / magazine | External URL in new tab |
| faguquanji / short_story | Deep-dive scoped chat against that record (today's desktop pattern) |
| qa / venues | External URL — these are reference items, not deep-readables |

### Deduplication

Today's `lib/citations-adapter.ts` (desktop) and `lib/citations.ts` (mobile-web) group by `source_url`. With unified retrieval, the same record can still appear via multiple chunks. **Keep the dedup-by-source_url logic unchanged** — it remains correct.

### Payload shape

**No protocol change required.** The backend already emits per-citation `metadata` with most type-specific fields. Frontend renders by switching on `metadata.source_type`.

```typescript
type Citation = {
  chunk_id: string; text: string; title: string;
  source_url: string | null; score: number | null;
  metadata: {
    source_type: "faguquanji" | "qa" | "events" | "news" | "audio" |
                 "video_ddmtv01" | "video_ddmtv02" | "video_ddmmedia1321" |
                 "venues" | "magazine" | "short_story";
    record_id?: string; chunk_index?: number; publish_date?: string;
    book_title?: string; chapter_title?: string;
    venue_name?: string; address?: string; phone?: string;       // venues
    series_name?: string; unit_name?: string;                     // audio/video
    playback_url?: string; duration_s?: number;
    start_s?: number; end_s?: number;
    attribution?: string;
  };
};
```

## Follow-up chip system design

The follow-up area below each assistant turn is the **post-hoc disambiguation surface** AND the **cross-corpus enrichment surface**. With unified retrieval producing mixed citations, follow-up chips need to carry richer types than text-only suggestions.

### Chip type taxonomy

| Type | What | Action when tapped | Example |
|---|---|---|---|
| **`query`** | A follow-up question (today's behavior) | Send as next user turn | "禪修和靜坐有什麼不同?" |
| **`scope_query`** | Follow-up question scoped to a specific corpus | Send as next user turn with `metadata.source_type` set | `📅 看相關活動 →` (scopes to events) |
| **`media`** | A specific audio/video chunk to play | Open inline player (Phase 4) or external (Phase 3) | `▶ 聖嚴法師談禪修 (5:32)` |
| **`event_card`** | A specific upcoming event | Open registration URL externally | `📅 11/22 線上初級禪訓班 [了解更多]` |

### Origin of each chip type — hybrid by design

| Origin | Used for |
|---|---|
| **LLM-generated per turn** (today's `suggestions/final`) | Text `query` chips — the "you might also ask" surface |
| **Selected from current turn's citations** | `media` and `event_card` chips — pull from the citation set, surface ones the answer didn't fully exploit |
| **Pre-computed per corpus daily** (per features_v6 starter pills) | `scope_query` chips like `📅 看本週活動` — generic redirections to curated content |

Most natural pattern: hybrid. LLM produces `query` suggestions; backend post-processor scans the citation set + corpus pointers to add 1-2 `media` / `event_card` / `scope_query` chips that complement the answer.

### Chip count and mix

Per assistant turn, propose:
- **2-3 `query` chips** (LLM-generated text questions) — always present
- **0-2 `media` or `event_card` chips** (from citations) — when relevant content exists
- **0-1 `scope_query` chip** when retrieval mixed corpora — disambiguation surface

So 3-6 total chips per turn; less in the simple case, more when there's cross-corpus enrichment to surface.

### SSE payload shape

Extension of today's `suggestions/final` event:

```jsonc
{
  "suggestions": [
    { "id": "s1", "type": "query", "label": "禪修和靜坐有什麼不同?",
      "action": "send",
      "payload": { "text": "禪修和靜坐有什麼不同?" } },
    { "id": "s2", "type": "scope_query", "label": "📅 看相關活動",
      "action": "send",
      "payload": { "text": "近期禪修活動", "source_type": "events" } },
    { "id": "s3", "type": "media", "label": "▶ 聖嚴法師談禪修 (5:32)",
      "action": "play",
      "payload": { "playback_url": "https://...", "title": "...",
                   "duration_s": 332, "source_type": "audio" } },
    { "id": "s4", "type": "event_card", "label": "📅 11/22 線上初級禪訓班",
      "action": "open",
      "payload": { "url": "https://...", "title": "初級禪訓班",
                   "venue": "線上", "start": "2026-11-22T19:00",
                   "end": "2026-11-22T21:00" } }
  ]
}
```

**Backwards-compatible**: clients that only know the old text-only shape can fall back to `payload.text` for `query` / `scope_query` types and ignore unknown types.

### Visibility & layout

| Surface | Render |
|---|---|
| Desktop | Full chip row + media chips inline-expandable to player (Phase 4) |
| Mobile-web | Horizontal scroll row of compact pills; tap = action |

Chips appear after each assistant turn, persist until the next user turn arrives (then they disappear, replaced by the new turn's chips).

## Event promotion — sponsor requirement, designed without forcing

The sponsor reasonably wants events visibility (the original purpose of the `/events` tab). With tabs going away, event promotion has to live somewhere — most naturally in the follow-up chip area. The constraint: **promote without forcing or misleading**. Specifically:

- **Don't force**: don't show an event chip on every turn regardless of relevance
- **Don't mislead**: don't show events that have nothing to do with the user's question
- **Respect attention**: chips look like related-content recommendations, not ads
- **Time-aware**: don't surface events that already passed or are too far out

### Promotion gating algorithm

The default rule: **piggyback on the reranker's judgment**. If the unified retrieval already surfaced an `events` chunk into the top-5 citations (via natural rerank score), the system has implicit permission to promote that event in the follow-up chips. If the reranker did *not* surface events, no event chip — that turn's topic isn't event-relevant.

```python
def select_event_chip(citations, recent_chip_history) -> EventCard | None:
    # 1. Find events chunks in citations
    event_citations = [c for c in citations if c.metadata.source_type == "events"]
    if not event_citations:
        return None  # respect: reranker didn't deem events relevant

    # 2. Pick the best-scored, with date filtering
    today = date.today()
    candidates = []
    for c in event_citations:
        end_date = parse_date(c.metadata.get("end_date") or c.metadata.publish_date)
        if not end_date: continue
        days_until = (end_date - today).days
        if days_until < 0: continue       # past event — skip
        if days_until > 60: continue      # too far out — less actionable
        candidates.append((c, days_until))

    if not candidates: return None
    # 3. Frequency cap: don't show events on consecutive turns
    if recent_chip_history and recent_chip_history[-1].had_event_chip:
        return None
    # 4. Pick the soonest of the candidates
    chosen = min(candidates, key=lambda x: x[1])[0]
    return EventCard(chosen)
```

### Layered safeguards

| Layer | What | Why it matters |
|---|---|---|
| **Reranker-gating** | Only promote events that appeared in top-5 citations | Topical relevance — if the reranker didn't pick it, the user wasn't asking about it |
| **Time-window filtering** | 0-60 days from today, registration still open | Actionability — past events confuse, far-future events are forgotten |
| **Frequency cap** | At most 1 event chip per N turns within a thread | Avoid repetition — feels like ads if every turn pushes events |
| **Chip framing** | Label like `📅 11/22 線上初級禪訓班 [了解更多]`, not `[立即報名]` | Tone — neutral CTA reads as recommendation, not sales pressure |
| **Position** | Event chips appear *after* `query` chips in the chip row | Hierarchy — natural follow-up questions come first; event card is supplementary |
| **Attribution clarity** | Event chips visually distinct from query chips (calendar icon + date prefix) | Honesty — user instantly knows "this is an event suggestion, not a question I might ask" |

### Edge cases worth noting

- **Time-only queries** ("這週末有什麼活動?") — temporal intent IS the query; events should dominate citations naturally; the rules above handle this fine
- **Topic mismatch** — if user asks about doctrine but the corpus also has a "禪修活動 with that doctrine theme" event, the reranker may surface the event. That's fine — it IS topically related, even if the user's primary intent was doctrine. The chip lets them dig in if they want.
- **No upcoming events match topic** — chip slot stays empty. Don't fill with a generic "see all events" chip; that crosses into "forced promotion."
- **User explicitly opts out** — future enhancement: a settings toggle "show event suggestions" that gates this whole pathway. Default on.

### What this is *not*

- **Not** a permanent banner ("upcoming events" sidebar) — too pushy
- **Not** an event chip on every turn — feels mechanical
- **Not** a chip whose label is a sales CTA — undermines trust
- **Not** the system arbitrarily injecting events that didn't appear in retrieval — would mislead

### Sponsor's interest is served

The events corpus stays *promoted by relevance*, not by force. When a query is event-adjacent, the user gets an event chip in 1 tap; when it's not, they're not bothered. Aggregate impact over many user-turns: events reach interested users without noise to uninterested ones.

### Design analogy: organic search vs advertisement

The right mental model for this design is **Google Search circa 2005** — an organic-results page where ads, when they appear, are clearly marked, visually distinct, relevance-gated, and position-restricted. The mapping is direct:

| Search-engine principle | This design |
|---|---|
| Ads visually distinct from organic results | Event chips have calendar icon + date prefix; visually distinct from query chips |
| Strict relevance gating ("if no relevant ads, show no ads") | Reranker-gating — only promote events that already surfaced in top-5 citations |
| Limited count per page | Frequency cap: at most 1 event chip per N turns within a thread |
| Position constraints (ads below organic, not above) | Event chips appear *after* query chips in the chip row |
| Honest framing — "Ad" / "Sponsored" labels | Calendar icon + date prefix instantly signals "this is an event suggestion" — neutral CTA framing (`了解更多`, not `立即報名`) |
| User can ignore without missing core content | Event chips never replace `query` chips; the answer itself never inserts event listings the user didn't ask for |

What Google **got wrong over time** is also instructive — these are the failure modes we should consciously resist:

| Google's drift | Equivalent failure mode here |
|---|---|
| Eroded visual distinction (yellow background → just "Ad" text) | Letting event chips look identical to query chips over time |
| Increased ad density year over year | Bumping the frequency cap from 1-of-N to "every turn" |
| Ads on queries with no commercial intent | Surfacing event chips when the reranker did NOT pick events |
| Ad copy that looks like organic results | Event chips with sales-y copy that mimics natural recommendations |

**Asymmetry worth naming**: unlike Google ads (external buyers paying for placement), our events are first-party content from the same organisation that runs the assistant. There's no financial incentive pulling toward over-promotion. The discipline is purely a product/UX one: respect user trust by treating events as recommendations, not as a placement we're paid to deliver.

**Trust-preserving review cadence** (post-launch operational): periodically audit a sample of turns where event chips appeared. Did the chip belong on that turn? If chip-precision drops below ~80% (event chip on turns where no human reviewer would say it was relevant), tighten the gating threshold rather than relaxing it.

## Open questions for chip system

1. **Chip count cap** — is 3-6 always right, or should it scale with answer length?
2. **Cross-corpus chip selection** — pure citation-based (proposed) vs LLM judgment vs both?
3. **Event date filtering thresholds** — 0-60 days proposed; tighter? wider?
4. **Audio playback inline (Phase 4) vs always-external (Phase 3)** — defer to later; ship Phase 3 with external links
5. **Chip persistence across the thread** — current proposal is "disappear when next user turn arrives"; alternative is "stay in scrollback"
6. **Frequency cap N** — 1-of-2 turns? 1-of-3? Empirically tune after launch
7. **Mobile chip count** — desktop can show 6, mobile may need to cap at 3-4 due to horizontal-scroll friction

## Phased rollout

1. ~~**Phase 0 — multi-corpus retrieval prototype**~~ ✅ **DONE 2026-05-03**. Three retrieval strategies measured (fan_out @20, fan_out @10, unified). Pivoted from fan_out to unified after Stage 2d data. Migration script and unified collection live in production Milvus (`rag_bot_unified_<ts>`); per-source collections retained as fallback.
2. ~~**Phase 1 — offline evaluation**~~ ✅ **DONE 2026-05-03**. Stages 2a-g all run; results in this doc. Pattern A (LLM weaves) empirically validated on 6 eval queries + 4 ambiguous bare-noun queries + 2 simplified-Chinese real-user queries. No retrieval-layer router or filter needed.
3. **Phase 0d — backend wiring** (next): add `multi_search(query, source_types=None, limit)` to `RagService` Protocol; implement in rag_bot adapter via direct unified-collection query; route from `app/agent/nodes.py:retrieve` when `metadata.source_type` is absent. Behind `RETRIEVAL_AUTO_MODE` feature flag (defaults `off` to preserve today's behavior). Per-source path stays for explicit `source_type` requests.
4. **Phase 2 — frontend MVP**: composer + Auto chip + basic text follow-up chips on desktop, behind the same feature flag. Internal smoke.
5. **Phase 3 — rich follow-ups**: media chips, event cards, news cards. Daily-refresh starter pills.
6. **Phase 4 — live A/B**: ramp from 10% to 100% over a 2-week window. Tabs hidden once at 100%.
7. **Phase 5 — mobile parity**: the ~80% mobile slice (no manual scope override, simpler follow-ups).
8. **Phase 6 — anaphora improvements**: dedicated sprint on multi-hop scope tracking once the basic flow is in production and we have real-user examples.

## Non-goals (this design)

- Backend-side scope router (LLM classifier or embedding centroids) — we're starting with multi-corpus retrieval; explicit router is a future optimization if multi-corpus is too slow / too noisy.
- Confidence percentages or explainability UI for the routing decision.
- Removing the tab pages from the codebase — they hide from nav but stay routable until the new model is fully validated.
- Per-user customisation of starter pills (e.g., based on past queries). Starter pills are global per corpus.
- Voice input integration with the new chip flow — keep voice on the composer; tapping a chip is always tap, not speak.

## References

- User feedback summary leading to this redesign: discussed in conversation 2026-05-02; tabs "need explanation to use", users suggest pills, but pills inherit the scope-mode opacity problem.
- Existing per-tab feature specs: [features_v3.md](features_v3.md) (audio), [features_v4.md](features_v4.md) (whats-new), [features_v5.md](features_v5.md) (voice).
- Backend RAG integration: [docs/rag_integration.md](rag_integration.md) — defines the `RagService` Protocol that multi-corpus retrieval extends.
- Retrieval baseline + tooling: `/mnt/data/rag_bot/docs/benchmark_notes.md` — particularly "Per-source Scoped Retrieval Baseline (2026-05-03)" (the floor multi-corpus must approach), the rerank tradeoff section (k=10 is the recommended balance), and the judge-LLM section (Tier 1 local Qwen3-8B, Tier 2 DeepSeek, `truths_extraction_limit=20`).
