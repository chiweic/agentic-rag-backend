"""Google News RSS provider for the 時事禪心 tab news feed.

Fetches the Traditional-Chinese Taiwan top-news RSS from
`news.google.com/rss`. No API key needed; the feed is rate-limited
by Google so we keep a 10-minute in-memory cache per process.

Google News RSS titles include " - 來源名稱" suffixes; we strip the
suffix when a `<source>` child is present, so the frontend card
shows the clean headline and the source name lands in
`NewsHeadline.source`.

The protocol requires `get_headlines` to never raise — upstream
errors (network, XML, rate limit) log and return an empty list so
the endpoint's `no_news` branch renders a clean empty state.
"""

from __future__ import annotations

import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from app.core.logging import get_logger
from app.news.protocol import NewsHeadline

log = get_logger(__name__)

_BASE_URL = "https://news.google.com/rss"
_DEFAULT_PARAMS = {"hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}
_CACHE_TTL_SECONDS = 600  # 10 min — Google throttles aggressive polling.
_FETCH_TIMEOUT_SECONDS = 10.0
_USER_AGENT = "Mozilla/5.0 (compatible; ddm-backend-v2 news adapter; " "+https://www.ddm.org.tw)"


class GoogleNewsRssFeed:
    """`NewsFeedProvider` backed by `news.google.com/rss` (zh-TW / TW).

    Cache is per-instance; the factory creates one instance per
    process via `build_news_feed`, so the cache is effectively
    process-wide.
    """

    def __init__(self, *, cache_ttl_seconds: float = _CACHE_TTL_SECONDS) -> None:
        self._cache: list[NewsHeadline] | None = None
        self._cache_expires: float = 0.0
        self._cache_ttl = cache_ttl_seconds

    def get_headlines(self, limit: int = 6) -> list[NewsHeadline]:
        if limit <= 0:
            return []
        try:
            headlines = self._load()
        except Exception:  # noqa: BLE001
            log.exception("google_rss | fetch or parse failed")
            return []
        return headlines[:limit]

    def _load(self) -> list[NewsHeadline]:
        now = time.time()
        if self._cache is not None and now < self._cache_expires:
            return self._cache

        url = f"{_BASE_URL}?{urllib.parse.urlencode(_DEFAULT_PARAMS)}"
        req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(req, timeout=_FETCH_TIMEOUT_SECONDS) as resp:
            body = resp.read()

        headlines = parse_google_rss(body)
        self._cache = headlines
        self._cache_expires = now + self._cache_ttl
        log.info("google_rss | fetched %d headlines, cached %.0fs", len(headlines), self._cache_ttl)
        return headlines


def parse_google_rss(xml_bytes: bytes) -> list[NewsHeadline]:
    """Parse a Google News RSS payload into `NewsHeadline` rows.

    Exposed as a module-level function so tests can feed fixture XML
    without instantiating the fetcher.
    """
    root = ET.fromstring(xml_bytes)
    items = root.findall(".//item")
    results: list[NewsHeadline] = []
    for idx, item in enumerate(items):
        title_el = item.find("title")
        link_el = item.find("link")
        source_el = item.find("source")
        pub_el = item.find("pubDate")
        if title_el is None or link_el is None:
            continue

        raw_title = (title_el.text or "").strip()
        source = (source_el.text or "").strip() if source_el is not None else ""
        # Google News appends " - 來源" to titles; strip when we have
        # the explicit <source> child so the card shows a clean title
        # and source lives in NewsHeadline.source.
        title = raw_title
        if source and raw_title.endswith(f" - {source}"):
            title = raw_title[: -len(f" - {source}")].rstrip()
        if not title:
            continue

        results.append(
            NewsHeadline(
                id=f"gnews-{idx}",
                title=title,
                source=source,
                url=(link_el.text or "").strip() or None,
                published_at=((pub_el.text or "").strip() if pub_el is not None else None),
            )
        )
    return results
