Version 3 frontend feature: Audio/Video tab

The Audio/Video tab （聖嚴師父身影）adding to the primary app, include the following features:

1. Similar to the Events Recommendation, this tab 聖嚴師父身影，will use user recent querry, and try to generalize to find recommendation of Audio and Video from collection. Particularly enable "Audio", "Video_ddmtv01" and "Video_ddmtv02". Do not use Video_ddmmedia1321

2. Similar to the Events Recommendation, all Thread chat in this tab will use search_collections using "Audio", "Video_ddmtv01" and "Video_ddmtv02" to retrieve relevant chunks (please propose ways to combine chunks from three different sources) and then to generation.

3. The rendering on the tab will use the tool-ui, with the following example on video rendering:
import { Video } from "@/components/tool-ui/video"

<Video
  id="video-preview-actions"
  assetId="video-actions"
  src="https://archive.org/download/NatureStockVideo/IMG_9500_.mp4"
  poster="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=900&auto=format&fit=crop"
  title="Forest Canopy"
  ratio="16:9"
  durationMs={8000}
/>
<LocalActions
  surfaceId="video-preview-actions"
  actions={[
    {
      "id": "share",
      "label": "Share",
      "variant": "default"
    },
    {
      "id": "download",
      "label": "Download",
      "variant": "secondary"
    }
  ]}
  onAction={(actionId) => console.log("Local action:", actionId)}
/>

or Audio with the sample: 
import { Audio } from "@/components/tool-ui/audio"

<Audio
  id="audio-preview-actions"
  assetId="audio-actions"
  src="https://cdn.pixabay.com/audio/2022/03/10/audio_4dedf5bf94.mp3"
  title="Morning Forest"
  description="Dawn chorus recorded in Olympic National Park"
  artwork="https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&auto=format&fit=crop"
  durationMs={42000}
/>
<LocalActions
  surfaceId="audio-preview-actions"
  actions={[
    {
      "id": "download",
      "label": "Download",
      "variant": "secondary"
    },
    {
      "id": "share",
      "label": "Share",
      "variant": "default"
    }
  ]}
  onAction={(actionId) => console.log("Local action:", actionId)}
/>