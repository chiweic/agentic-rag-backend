/**
 * Placeholder for the event-recommendations tab (features_v2.md §4a).
 * The real implementation lands in two follow-up commits:
 *   1. Backend /api/recommendations + recent-query summary service.
 *   2. Card grid UI replacing this placeholder.
 */
export default function EventsPage() {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="font-semibold text-2xl text-foreground">活動推薦</h1>
        <p className="text-muted-foreground text-sm">
          根據您最近的提問,推薦法鼓山即將舉辦的活動。即將推出。
        </p>
      </div>
    </main>
  );
}
