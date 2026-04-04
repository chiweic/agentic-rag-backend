"""LangGraph pipeline — deterministic flow, each step a node.

Current graph (no tools yet):
    START → generate → END

Future RAG graph:
    START → extract_query → dense_retrieve → sparse_retrieve
          → merge_rrf → rerank → generate → END
"""

from langgraph.graph import END, START, StateGraph

from app.agent.nodes import generate
from app.agent.state import AgentState

# Checkpointer is set at startup via set_checkpointer()
_checkpointer = None
agent_graph = None


def _build_graph(checkpointer):
    """Build and compile the agent graph with the given checkpointer."""
    graph = StateGraph(AgentState)

    # --- nodes ---
    graph.add_node("generate", generate)

    # --- edges (deterministic, no conditional routing) ---
    graph.add_edge(START, "generate")
    graph.add_edge("generate", END)

    return graph.compile(checkpointer=checkpointer)


def set_checkpointer(checkpointer):
    """Called at app startup to inject the async checkpointer."""
    global agent_graph
    agent_graph = _build_graph(checkpointer)
