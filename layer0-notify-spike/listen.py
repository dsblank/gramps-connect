"""Throwaway Layer 0 spike: LISTEN tree_changes, print each notification.

Run on its own dedicated, non-pooled connection (required for LISTEN),
per PLAN.md. Ctrl-C to stop.
"""
import select
import time

import psycopg2

DSN = "host=localhost dbname=gramps_connect user=gramps password=gramps"


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("LISTEN tree_changes;")
    print("Listening on 'tree_changes'... (Ctrl-C to stop)")

    while True:
        if select.select([conn], [], [], 5) == ([], [], []):
            continue
        conn.poll()
        while conn.notifies:
            notify = conn.notifies.pop(0)
            print(f"{time.strftime('%X')}  pid={notify.pid}  payload={notify.payload}")


if __name__ == "__main__":
    main()
