// Tiny module-level flag — set by the mic button when dictation
// contributes to the composer, read + cleared once by the runtime
// adapter when it builds the next /runs/stream body. The runtime then
// includes `metadata.input_mode = "voice"` so the backend can tag the
// Langfuse trace (features_v5.md §1 decision 9).
//
// Plain module state instead of a React store: the flag is single-use
// and write-only from one component → read-only from another, so the
// reactive overhead of zustand isn't earning anything here.
let pendingVoiceFlag = false;

export function markVoiceInput(): void {
  pendingVoiceFlag = true;
}

export function consumeVoiceInputFlag(): boolean {
  const v = pendingVoiceFlag;
  pendingVoiceFlag = false;
  return v;
}

// Test/escape hatch — tests can reset between runs without coupling to
// the consume semantics.
export function resetVoiceInputFlag(): void {
  pendingVoiceFlag = false;
}
