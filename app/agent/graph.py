"""LangGraph pipeline — deterministic flow, each step a node.

Current graph:
    START → retrieve → generate → END

Retrieval uses whatever `RagService` is injected via
`config["configurable"]["rag_service"]` (see `app.rag.get_rag_service`
and the API layer that plumbs it in on each run).

Future expansion (add between retrieve and generate when needed):
    extract_query → dense_retrieve → sparse_retrieve
                  → merge_rrf → rerank
"""

from langgraph.graph import END, START, StateGraph

from app.agent.nodes import generate, retrieve
from app.agent.state import AgentState

# Checkpointer is set at startup via set_checkpointer()
_checkpointer = None
agent_graph = None


def _build_graph(checkpointer):
    """Build and compile the agent graph with the given checkpointer."""
    graph = StateGraph(AgentState)

    # --- nodes ---
    graph.add_node("retrieve", retrieve)
    graph.add_node("generate", generate)

    # --- edges (deterministic, no conditional routing) ---
    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", END)

    return graph.compile(checkpointer=checkpointer)


def set_checkpointer(checkpointer):
    """Called at app startup to inject the async checkpointer."""
    global agent_graph
    agent_graph = _build_graph(checkpointer)
