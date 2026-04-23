Version 4 frontend feature: What's New tab

The What's New tab （新鮮事）adding to the primary app, include the following features:

1. Similar to the Events start suggestion, this tab 新鮮事 use user recent querry, and try to generalize to find suggestions. However, these suggestions should combine the real-time local (targeted area: Taiwan) news and Organization (DDM) internal news. Example on such the query would be: "美伊戰爭 如何讓人安定心情"，while the real-time news highlight the "issues" on the begining of query, while using buddhist teaching on the "action" part of the query, and collection should include "faguqunji, audio, video_ddmtv01, video_ddmtv02, video_ddmmedia1321". 

2. We will need to set up an Real-time News API to support the above feature. The DDM internal news should refer to the collection news, but limited to recent time period.

3. Answer generated template: the idea on this tab should be to simulate the style and response (with quotes) frmo master Sheng Yen. This will be used to build the next milestone feature such that a avitare with master's voice (clone from text-to-speech) for playback. No voice button or functions on this milestone, but just so that you are aware.

4. All Thread chat in this tab will use search_collections from previous discussions to retrieve relevant chunks (please propose ways to combine chunks from three different sources). The citations will NOT use card with multimedia style, but as stacked with links to url.

