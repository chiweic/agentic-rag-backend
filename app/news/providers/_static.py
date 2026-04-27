"""Static sample news feed — the default provider for dev / CI.

Returns a fixed rotation of Taiwan-flavoured headlines so the 新鮮事
tab works end-to-end without an external API key or network call.
Real providers (RSS, NewsAPI, internal DDM feed) can be added under
`app/news/providers/` and selected via `NEWS_FEED_PROVIDER` env var.
"""

from __future__ import annotations

from app.news.protocol import NewsHeadline

# Intentionally broad so the LLM has a variety of themes to riff on
# when building dharma-action questions. Kept evergreen rather than
# dated — these are illustrative, not true breaking news.
_SAMPLE_HEADLINES: list[NewsHeadline] = [
    NewsHeadline(
        id="static-0",
        title="全球局勢緊張 股市波動加劇",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-1",
        title="氣候變遷造成極端天氣 台灣多地降雨破紀錄",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-2",
        title="職場壓力調查:近七成上班族感到焦慮",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-3",
        title="AI 快速發展 專家呼籲關注心理健康",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-4",
        title="高齡化社會來臨 家庭照顧者身心俱疲",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-5",
        title="兩岸關係緊張 民眾關切社會安定",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-6",
        title="青年失業率攀升 低薪困境待解",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
    NewsHeadline(
        id="static-7",
        title="公益團體:疫後憂鬱症就醫人數明顯增加",
        source="樣本新聞",
        url="https://www.ddm.org.tw/",
    ),
]


class StaticSampleFeed:
    """`NewsFeedProvider` returning a fixed list of sample headlines."""

    def get_headlines(self, limit: int = 6) -> list[NewsHeadline]:
        if limit <= 0:
            return []
        return list(_SAMPLE_HEADLINES[:limit])
