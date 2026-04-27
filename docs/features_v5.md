Version 5 frontend feature: Voice input (dictation)

## Goal

Add voice input to the chat composer so a user can speak instead of type. Transcribed text appears in the input, the user reviews and edits if needed, then sends normally via the existing Send button / ⏎ flow.

**Explicitly deferred to a later milestone**: text-to-speech, dictated answers, conversational mode, avatar / voice clone of 聖嚴法師.

## Decisions (committed)

1. **Engine — browser-native Web Speech API** (`window.SpeechRecognition` / `webkitSpeechRecognition`). On-device, free, zero backend. **No audio is captured, stored, or transmitted** — Web Speech is text-only by design, and we explicitly do not run a parallel `MediaRecorder`. No personal data leaves the device beyond the resulting text (which is the message the user sends anyway).
2. **Pattern — dictation (not push-to-talk, not conversation mode)**. Mic button toggles; while on, transcribed text streams into the composer; user still clicks Send. Forgiving — they can edit before sending.
3. **Language — `zh-TW` as default**, hard-coded in this milestone. Can be parameterized later (English users, `zh-CN`, etc.).
4. **Interim results on** — partial transcription shows live as the user speaks, replaced by the final string when the engine settles. Feels responsive, single-line change in the handler.
5. **Button placement — inline in the composer action row**, leftmost (before Send). Mirrors assistant-ui's attachment-button convention. Same component appears on `/`, `/events`, `/sheng-yen`, `/whats-new` since they all share [thread.tsx](/mnt/data/backend/frontend/components/assistant-ui/thread.tsx).
6. **Browser support — feature-detected**. Chrome / Edge / Safari render the button; Firefox (no Web Speech support) hides it cleanly. No polyfill.
7. **Permission UX — rely on the native browser prompt**. First click triggers the mic permission dialog. No pre-emptive explainer — the native prompt is enough and users know it.
8. **Error handling — silent on the happy path, inline status on the unhappy path**. Permission denied → button shows a muted "mic blocked" state with a tooltip explaining how to unblock in the browser. Mic busy / engine error → brief inline text; recover on next click.
9. **Trace tagging — voice-originated turns are tagged in Langfuse.** When the user sends a message that came from the dictation path, the frontend includes `metadata.input_mode = "voice"` on the `/runs/stream` request; the backend appends a `voice` tag to the Langfuse trace. Lets us count voice-vs-keyboard usage in Langfuse without storing any user data. No new backend tables, no new storage.
10. **No cloud STT fallback in this milestone.** If on-device accuracy turns out to be unacceptable in real use, that becomes a Phase 2 follow-up with its own backend endpoint (`POST /api/transcribe`) — not in scope now.
11. **No audio capture, opt-in, or fine-tune-data collection in this milestone.** Documented as Phase 2 (see Non-goals). Phase 1 stays a pure-frontend feature with one cosmetic backend hook for the trace tag.

## Assumptions (worth calling out)

1. **Punctuation**: `zh-TW` Web Speech rarely inserts punctuation. The retrieval node doesn't care — it embeds the raw user query — so un-punctuated long runs are fine for answer quality. If users complain about the look of their own messages in the thread history, we can post-process (add commas on long pauses) later.
2. **Accuracy good enough**: for the short questions typical of this app ("什麼是禪？", "如何放鬆？"), zh-TW Web Speech is expected to land ≥90% word accuracy. We accept the risk of worse results on longer/technical queries and treat user feedback as the signal to upgrade.
3. **HTTPS is already in place**: Web Speech requires it. We have it via Cloudflare Tunnel at `app.changpt.org`, so no infrastructure work.
4. **Backend change is cosmetic**: only the trace-tag plumbing. Voice input is otherwise a pure frontend feature until/unless we add cloud STT or audio upload.
5. **No mobile-specific work in this milestone**. Chrome on Android and Safari on iOS both support the API; the existing composer layout should work as-is. We'll validate on mobile during acceptance, not redesign.
6. **One mic-button component shared across all four tabs** is the right call — no per-tab customization is needed.
7. **No personal data is captured.** The `voice` trace tag records only that a turn was dictated, not the audio nor any biometric trait. No consent flow needed for Phase 1.

## Implementation sketch (one commit)

**Backend** — minimal hook for the trace tag:

- [app/api/threads.py](/mnt/data/backend/app/api/threads.py) — when building `langfuse_config`, if `request.metadata.get("input_mode") == "voice"`, append `"voice"` to the existing `tags=["thread"]`. ~3 lines, mirrors the existing `source_type` / `generate_variant` extraction pattern.
- [app/core/tracing.py](/mnt/data/backend/app/core/tracing.py) — already accepts `tags: list[str]`; no change needed.

**Frontend**, all under [frontend/components/assistant-ui/](/mnt/data/backend/frontend/components/assistant-ui/):

1. **`useSpeechRecognition.ts`** — small hook wrapping the Web Speech API. Surface:
   ```ts
   const { supported, listening, error, start, stop } = useSpeechRecognition({
     lang: "zh-TW",
     interim: true,
     onResult: (text, isFinal) => void,
   });
   ```
   Internally: feature-detect via `("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window)`; manage a single `SpeechRecognition` instance; wire `onresult`, `onerror`, `onend`.

2. **`voice-input-button.tsx`** — uses the hook + `useComposerRuntime` (assistant-ui) to push transcribed text into the composer via `setText`. Interim results overwrite; final results commit. Icon: `Mic` / `MicOff` from lucide. Disabled rendering when `!supported`. Sets a session-scoped flag the composer reads when composing the next send.

3. **Per-message voice flag** — wherever the frontend currently builds the `/runs/stream` request body (the runtime adapter that wraps `langgraphRequest`), include `metadata.input_mode = "voice"` if the latest user turn originated from the mic. Single boolean lookup. Cleared after send.

4. **`thread.tsx` composer action row** — drop the new button in as the first child of the composer actions, next to the existing send control.

Acceptance scope: ~120 lines frontend + ~3 lines backend. No tests strictly required for this milestone (it's a thin wrapper around a browser API we can't easily mock), though a Playwright smoke with a mocked `SpeechRecognition` global would be nice-to-have.

## Verification

1. On Chrome desktop at `app.changpt.org`: mic icon renders in the composer; clicking it prompts for permission; spoken Chinese appears in the input field with interim updates; clicking Send submits the final text to the existing `/threads/{id}/runs/stream`.
2. On Firefox: mic icon does **not** render (silent feature-detect).
3. On a browser where permission is denied: button goes to a muted state; hovering shows a "microphone blocked" tooltip.
4. Pressing the mic button a second time while listening stops the engine and leaves whatever text is already in the composer.
5. Golden path on `/events`, `/sheng-yen`, `/whats-new` behaves identically to `/` (same component).
6. No regressions on the existing keyboard-typing flow in any of the four tabs.
7. **Trace tagging**: a voice-originated turn appears in Langfuse with the `voice` tag; a keyboard-originated turn does not. Filterable in the Langfuse Users dashboard so we can count voice adoption per user / per day.

## Non-goals (for this milestone)

- **Audio capture or upload of any kind.** No `MediaRecorder`, no `POST /api/audio`, no opt-in toggle, no fine-tune-data collection. All deferred to Phase 2.
- **Rich voice telemetry** (duration, interim count, edited-before-send, accuracy proxies). Phase 1 ships exactly one signal: the `voice` trace tag. Richer telemetry can layer on later without a schema change.
- Text-to-speech of the assistant's reply (deferred to the 聖嚴法師 voice-clone milestone).
- Conversation mode (mic stays on; auto-send on pause; auto-play reply). Requires TTS first.
- Cloud-based STT (Whisper / Google STT / Azure). Only pursued if on-device accuracy proves insufficient.
- Multi-language toggle / language detection.
- A "pre-explainer" modal before the native mic-permission prompt.
- Waveform / audio-level visualizer on the button.
- Punctuation post-processing.
- Hotkeys (e.g. hold-Space to dictate) — can add later if the button alone feels clunky.
- Backend `/api/transcribe` endpoint — only needed if we move off Web Speech.

## Phase 2 (out of scope here, named only so this spec doesn't paint us into a corner)

Once we want training data for fine-tuning a custom STT or voice-clone TTS:

- Settings toggle, default **off**, sticky across sessions, persisted server-side.
- When opted-in: `MediaRecorder` runs alongside Web Speech on the same mic stream; webm/opus blob uploads to a new authed `POST /api/audio` after send, associated with `(user_id, thread_id, message_id, transcript, edited_text)`.
- Storage on the server filesystem under `/data/audio/...` mounted as a docker volume (S3-migratable later). Not Postgres `bytea`, not Langfuse's MinIO.
- Retention policy decided when there's enough data to care.
- Consent copy naming purpose ("help improve voice recognition for Chinese dharma queries") and retention.
- Richer telemetry (`voice_duration_ms`, `interim_count`, `edited_before_send`) joins the trace tag at this point.

Phase 1 deliberately leaves the door open for all of the above without committing to any of it.

## Open questions (to revisit after real-user feedback)

- Do zh-TW users actually find the un-punctuated output acceptable in their own thread history? If not, do we post-process client-side or upgrade to a cloud STT that punctuates?
- Is the inline button discoverable enough, or does it need a first-time tooltip / Shepherd-style callout?
- Should the mic auto-stop after N seconds of silence, or only on user click? (Web Speech's default is to auto-stop fairly aggressively — may or may not need override.)
