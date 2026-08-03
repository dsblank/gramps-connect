"""Layer 3: relay Postgres NOTIFY events to WebSocket clients.

Identical mechanism to layer1-ws-relay/relay.py (that spike stays as-is,
pointed at Layer 0's throwaway schema) -- this is the same relay pointed
at the real SharedPostgreSQL "gramps" database and the real trigger
installed by triggers.sql, so Layer 2's actual client can connect to it.

Holds a dedicated, non-pooled LISTEN connection (required for LISTEN) and
re-broadcasts each 'tree_changes' notification to every connected
WebSocket client. No auth, no per-tree filtering -- thin/dumb broadcaster
by design (see PLAN.md); the client decides what a notification means for
it (which is also why the payload carries treeid/table/handle, not just a
bare ping).
"""
import asyncio
import select

import psycopg2
import websockets

DSN = "host=localhost dbname=gramps user=gramps password=gramps"
HOST, PORT = "localhost", 8766

clients = set()


async def handle_client(websocket):
    clients.add(websocket)
    print(f"client connected ({len(clients)} total)")
    try:
        async for _ in websocket:
            pass  # clients don't send anything; just hold the connection open
    finally:
        clients.discard(websocket)
        print(f"client disconnected ({len(clients)} total)")


async def broadcast(payload: str):
    if clients:
        await asyncio.gather(
            *(ws.send(payload) for ws in clients),
            return_exceptions=True,
        )


async def listen_for_notifies():
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("LISTEN tree_changes;")
    loop = asyncio.get_running_loop()

    while True:
        await loop.run_in_executor(None, select.select, [conn], [], [], 5)
        conn.poll()
        while conn.notifies:
            notify = conn.notifies.pop(0)
            print(f"relay: {notify.payload}")
            await broadcast(notify.payload)


async def main():
    # websockets' default ping_interval/ping_timeout (20s/20s) gives us
    # server-side idle-connection keepalive for free.
    async with websockets.serve(handle_client, HOST, PORT):
        print(f"WebSocket relay listening on ws://{HOST}:{PORT}")
        await listen_for_notifies()


if __name__ == "__main__":
    asyncio.run(main())
