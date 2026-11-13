#!/usr/bin/env python3
"""
ExamPulse High-Concurrency Benchmark & Stress Test
Demonstrates the platform handling high-volume burst traffic (up to 20,000 requests).

Usage:
  python backend/tests/benchmark_concurrency.py [total_requests] [concurrency] [target_url]
Example:
  python backend/tests/benchmark_concurrency.py 20000 500
"""

import sys
import time
import asyncio
import httpx

async def worker(client: httpx.AsyncClient, target_url: str, num_requests: int, results: list, progress_counter: list, total_requests: int):
    for _ in range(num_requests):
        t0 = time.perf_counter()
        try:
            resp = await client.get(target_url)
            latency = (time.perf_counter() - t0) * 1000
            results.append((resp.status_code, latency))
        except Exception:
            latency = (time.perf_counter() - t0) * 1000
            results.append((500, latency))
        
        progress_counter[0] += 1
        current = progress_counter[0]
        step = max(500, total_requests // 10)
        if current % step == 0 or current == total_requests:
            pct = (current / total_requests) * 100
            print(f"   [Progress] {current:,} / {total_requests:,} requests completed ({pct:.0f}%)...")

async def run_benchmark(total_requests: int = 20000, concurrency: int = 500, target_url: str = "http://127.0.0.1:8001/health"):
    print("=" * 65)
    print("  EXAMPULSE HIGH-CONCURRENCY STRESS TEST")
    print(f"  Target:      {target_url}")
    print(f"  Total Req:   {total_requests:,}")
    print(f"  Concurrency: {concurrency:,} concurrent workers")
    print("=" * 65)

    req_per_worker = total_requests // concurrency
    results = []
    progress_counter = [0]

    limits = httpx.Limits(max_connections=concurrency + 100, max_keepalive_connections=concurrency)
    timeout = httpx.Timeout(30.0)

    start_time = time.perf_counter()
    async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
        tasks = [
            asyncio.create_task(worker(client, target_url, req_per_worker, results, progress_counter, total_requests))
            for _ in range(concurrency)
        ]
        await asyncio.gather(*tasks)

    total_time = time.perf_counter() - start_time
    total_completed = len(results)
    successes = sum(1 for status, _ in results if status == 200)
    failures = total_completed - successes
    latencies = [lat for _, lat in results]
    latencies.sort()

    rps = total_completed / total_time if total_time > 0 else 0
    p50 = latencies[int(len(latencies) * 0.50)] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0

    print("\nBENCHMARK RESULTS:")
    print(f" * Completed Requests: {total_completed:,}")
    print(f" * Successful (200 OK): {successes:,} ({(successes/total_completed)*100:.1f}%)")
    print(f" * Failed Requests:     {failures:,}")
    print(f" * Elapsed Time:        {total_time:.2f}s")
    print(f" * Throughput (RPS):    {rps:,.1f} requests/sec")
    print(f" * Latency p50:         {p50:.2f} ms")
    print(f" * Latency p95:         {p95:.2f} ms")
    print(f" * Latency p99:         {p99:.2f} ms")
    print("=" * 65)

if __name__ == "__main__":
    total = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
    conc = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    url = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8001/health"
    asyncio.run(run_benchmark(total, conc, url))
