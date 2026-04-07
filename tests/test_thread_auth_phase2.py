import pytest
from fastapi import HTTPException

from app.api.assisted_learning import list_modules
from app.api.threads import (
    RunStreamRequest,
    ThreadCreateRequest,
    ThreadUpdateRequest,
    create_thread,
    generate_title,
    get_thread_state,
    run_stream,
)
from app.api.threads import (
    delete_thread as delete_thread_route,
)
from app.api.threads import (
    list_threads as list_threads_route,
)
from app.api.threads import (
    update_thread as update_thread_route,
)
from app.core import thread_store
from app.core.auth import UserClaims, get_current_user
from app.main import app


def _claims(sub: str) -> UserClaims:
    return UserClaims(
        sub=sub,
        email=f"{sub}@example.com",
        email_verified=True,
        name=sub,
        picture=None,
        iss="https://accounts.google.com",
        aud="test-aud",
        exp=9999999999,
    )


def _uid(sub: str) -> str:
    return _claims(sub).user_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("post", "/threads", {}),
        ("get", "/threads", None),
        ("get", "/threads/unknown/state", None),
        (
            "post",
            "/threads/unknown/runs/stream",
            {"input": {"messages": [{"role": "user", "content": "hi"}]}},
        ),
        ("get", "/assisted-learning/modules", None),
    ],
)
async def test_protected_routes_require_auth(client, method, path, json_body):
    app.dependency_overrides.pop(get_current_user, None)

    request = getattr(client, method)
    if json_body is None:
        resp = await request(path)
    else:
        resp = await request(path, json=json_body)

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_post_threads_stores_owner_user_id(client):
    response = await create_thread(
        ThreadCreateRequest(metadata={"source": "test"}),
        _claims("user-a"),
    )
    thread_id = response.thread_id

    stored = await thread_store.get_thread(thread_id)
    assert stored is not None
    assert stored["user_id"] == _uid("user-a")
    assert stored["metadata"] == {"source": "test"}


@pytest.mark.asyncio
async def test_list_threads_is_scoped_to_owner(client):
    thread_a = (await thread_store.create_thread(user_id=_uid("user-a")))["thread_id"]
    await thread_store.update_thread(thread_a, user_id=_uid("user-a"), title="thread-a")

    thread_b = (await thread_store.create_thread(user_id=_uid("user-b")))["thread_id"]
    await thread_store.update_thread(thread_b, user_id=_uid("user-b"), title="thread-b")

    listed = await list_threads_route(_claims("user-a"))
    ids = {thread["thread_id"] for thread in listed}

    assert thread_a in ids
    assert thread_b not in ids


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action",
    [
        lambda thread_id: get_thread_state(thread_id, _claims("other-user")),
        lambda thread_id: update_thread_route(
            thread_id,
            ThreadUpdateRequest(title="hijack"),
            _claims("other-user"),
        ),
        lambda thread_id: delete_thread_route(thread_id, _claims("other-user")),
        lambda thread_id: run_stream(
            thread_id,
            RunStreamRequest(input={"messages": [{"role": "user", "content": "hi"}]}),
            _claims("other-user"),
        ),
        lambda thread_id: generate_title(thread_id, _claims("other-user")),
    ],
)
async def test_cross_user_thread_access_returns_403(client, action):
    thread_id = (await thread_store.create_thread(user_id=_uid("owner-user")))["thread_id"]

    with pytest.raises(HTTPException) as exc:
        await action(thread_id)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_delete_thread_does_not_remove_other_users_thread(client):
    thread_id = (await thread_store.create_thread(user_id=_uid("owner-user")))["thread_id"]

    with pytest.raises(HTTPException) as exc:
        await delete_thread_route(thread_id, _claims("other-user"))
    assert exc.value.status_code == 403

    stored = await thread_store.get_thread(thread_id)
    assert stored is not None
    assert stored["user_id"] == _uid("owner-user")


@pytest.mark.asyncio
async def test_assisted_learning_modules_requires_auth_and_succeeds_for_authenticated_user(client):
    app.dependency_overrides.pop(get_current_user, None)
    resp = await client.get("/assisted-learning/modules")
    assert resp.status_code == 401

    result = await list_modules(_claims("learner"))
    assert "modules" in result
    assert len(result["modules"]) >= 1
    for mod in result["modules"]:
        assert {"id", "title", "description", "href"} <= set(mod.keys())
