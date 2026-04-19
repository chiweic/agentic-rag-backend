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

4 add application level tabs, current main chat will be named "chat", adding another "event": can be an empty page with title "in progress".