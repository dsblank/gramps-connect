"""Throwaway test: simulate 2+ browser tabs connecting to the relay,
confirm both receive the same broadcast (proves fan-out)."""
import asyncio
import time

import websockets

URL = "ws://localhost:8765"


async def tab(name, received):
    async with websockets.connect(URL) as ws:
        print(f"{name}: connected")
        try:
            async for message in ws:
                t = time.time()
                received.append((name, t, message))
                print(f"{name}: {message}")
        except websockets.ConnectionClosed:
            pass


async def main():
    received = []
    tasks = [
        asyncio.create_task(tab("tab-A", received)),
        asyncio.create_task(tab("tab-B", received)),
    ]
    await asyncio.sleep(1)  # let both connect
    print("both tabs connected, now edit a row via psql...")
    await asyncio.sleep(15)  # window to observe a write
    for t in tasks:
        t.cancel()
    print(f"\ntotal messages received across both tabs: {len(received)}")


if __name__ == "__main__":
    asyncio.run(main())
