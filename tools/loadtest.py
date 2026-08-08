#!/usr/bin/env python3
"""
GOAL 1e - how many concurrent users this app supports on a 1 GB ceiling.

The ceiling is not a guess: Railway's Replica Limit for this service reads
"Memory: 1 GB / Plan limit: 1 GB", and the process was killed five times for
crossing it. So the question is not "is it fast" but "at what concurrency does
RSS approach 1 GB", and the answer has to be a number.

Reads RSS from /api/health, which reports process.memoryUsage() per request -
the same number the platform kills on. Stops at the first step that exceeds the
abort threshold, because the point is to find the ceiling, not to cross it.

  python3 tools/loadtest.py <base-url> <token>
"""
import asyncio
import json
import ssl
import statistics
import sys
import time
from urllib.parse import urlparse

# The bar, decided by the operator 2026-08-08: 500 concurrent CLEAN is
# enforced; 1,000 is measured and reported but informational. Reasoning: at
# identical capacity the 1,000 step sits exactly on the one-replica capacity
# edge, and whether the burst's tail crosses the 10s pool-acquire bound is
# arrival-shape dependent - the same code recorded 0 and 71 failures on
# different mornings (LOAD.md, 2026-08-08). A bar that flips on client
# arrival shape gates nothing; 500 has been clean under every shape observed
# and is far beyond current traffic. No second replica (cost), and the
# acquire timeout stays where it is (raising it fakes the number).
ENFORCED_MAX_USERS = int(__import__('os').environ.get('ENFORCED_MAX_USERS') or 500)

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://backend-production-e6a8.up.railway.app"
TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
STEPS = [int(x) for x in (__import__('os').environ.get('STEPS') or '50,200,500,1000').split(',')]
ABORT_RSS_MB = 800
REQUESTS_PER_USER = 3

# What a real user actually does on arrival: read the feed, read their matches
# (which is the scoring path), read the tracker.
PATHS = [
    "/api/jobs?limit=20&page=1",
    "/api/matches?limit=20&page=1",
    "/api/applications",
]

u = urlparse(BASE)
HOST, PORT, TLS = u.hostname, (u.port or (443 if u.scheme == "https" else 80)), u.scheme == "https"
CTX = ssl.create_default_context() if TLS else None


async def one_request(path):
    """One request, returning (ok, milliseconds). Errors count as failures."""
    t0 = time.perf_counter()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(HOST, PORT, ssl=CTX, server_hostname=HOST if TLS else None), timeout=30
        )
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {HOST}\r\n"
            f"Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        head = await asyncio.wait_for(reader.readuntil(b"\r\n"), timeout=30)
        status = int(head.split()[1])
        await asyncio.wait_for(reader.read(), timeout=30)
        writer.close()
        return status, (time.perf_counter() - t0) * 1000
    except Exception as e:
        # WHAT failed, not just that it did. "22% failed" with no failure mode
        # is a number nobody can act on.
        return type(e).__name__, (time.perf_counter() - t0) * 1000


async def user_session():
    out = []
    for path in PATHS[:REQUESTS_PER_USER]:
        out.append(await one_request(path))
    return out


async def health():
    """RSS as the process itself reports it - the number the platform kills on."""
    for _ in range(3):
        try:
            reader, writer = await asyncio.open_connection(HOST, PORT, ssl=CTX, server_hostname=HOST if TLS else None)
            writer.write(f"GET /api/health HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n".encode())
            await writer.drain()
            raw = (await asyncio.wait_for(reader.read(), timeout=20)).decode(errors="replace")
            writer.close()
            # Check the STATUS before reading the body: a 502 page is also JSON
            # and parses into nulls that read like missing fields.
            if " 200 " not in raw.split("\r\n")[0]:
                await asyncio.sleep(2)
                continue
            body = raw.split("\r\n\r\n", 1)[1]
            if body.strip().startswith(("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f")):
                # chunked: strip the size lines
                body = "".join(l for l in body.splitlines() if l.startswith("{"))
            return json.loads(body)
        except Exception:
            await asyncio.sleep(2)
    return {}


async def step(n):
    before = await health()
    t0 = time.perf_counter()
    results = await asyncio.gather(*[user_session() for _ in range(n)])
    wall = time.perf_counter() - t0
    after = await health()

    flat = [r for session in results for r in session]
    lat = sorted(ms for _, ms in flat)
    ok = sum(1 for outcome, _ in flat if outcome == 200)
    modes = {}
    for outcome, _ in flat:
        if outcome == 200:
            continue
        modes[str(outcome)] = modes.get(str(outcome), 0) + 1
    p95 = lat[int(len(lat) * 0.95) - 1] if lat else 0

    return {
        "users": n,
        "requests": len(flat),
        "ok": ok,
        "failed": len(flat) - ok,
        "failure_modes": modes,
        "p95_ms": round(p95),
        "median_ms": round(statistics.median(lat)) if lat else 0,
        "wall_s": round(wall, 1),
        "rss_before_mb": before.get("rssMb"),
        "rss_after_mb": after.get("rssMb"),
    }


async def main():
    print(f"target {BASE}  ceiling 1024 MB  abort at {ABORT_RSS_MB} MB\n")
    rows = []
    for n in STEPS:
        r = await step(n)
        rows.append(r)
        print(
            f"{r['users']:>5} users  {r['requests']:>5} req  ok {r['ok']:>5}  fail {r['failed']:>4}  "
            f"p95 {r['p95_ms']:>6} ms  {r['failure_modes'] or ''}  "
            f"rss {r['rss_before_mb']} -> {r['rss_after_mb']} MB  ({r['wall_s']}s)"
        )
        if (r["rss_after_mb"] or 0) > ABORT_RSS_MB:
            print(f"\nSTOPPED: RSS {r['rss_after_mb']} MB exceeded {ABORT_RSS_MB} MB at {r['users']} users.")
            break
        # Let it settle, so the next step measures that step and not this one.
        await asyncio.sleep(20)

    print("\n" + json.dumps(rows, indent=1))

    # The verdict, so this instrument IS the bar rather than a number someone
    # reads against a rule they remember. Steps at or under the enforced
    # ceiling must be failure-free; larger steps are reported, never fatal.
    enforced = [r for r in rows if r["users"] <= ENFORCED_MAX_USERS]
    info = [r for r in rows if r["users"] > ENFORCED_MAX_USERS]
    bad = [r for r in enforced if r["failed"]]
    for r in info:
        print(f"informational: {r['users']} users, {r['failed']} failed "
              f"(beyond the enforced bar of {ENFORCED_MAX_USERS} clean)")
    if bad:
        print(f"\nBAR FAILED: {', '.join(str(r['users']) for r in bad)} users "
              f"had failures at or under the enforced {ENFORCED_MAX_USERS}.")
        sys.exit(1)
    print(f"\nBAR MET: every step at or under {ENFORCED_MAX_USERS} users was failure-free.")
    sys.exit(0)


asyncio.run(main())
