# HTAP E-Commerce System

A full-stack Hybrid Transactional/Analytical Processing (HTAP) system for serving transactional (OLTP) and analytical (OLAP) workloads from the same e-commerce dataset.

The implementation uses PostgreSQL for transactional operations and ClickHouse for analytical workloads, with a snapshot synchronization pipeline between the two systems.

## Architecture

```
                         React + Vite
                              |
                              v
                    Node.js + Express API
                       /              \
                      v                v
               PostgreSQL          ClickHouse
                  OLTP                 OLAP
                    \                ^
                     \              /
                      \-- Snapshot Sync
```

### Components

- **Frontend:** React + Vite
- **Backend:** Node.js + Express + TypeScript
- **OLTP database:** PostgreSQL
- **OLAP database:** ClickHouse
- **Synchronization:** PostgreSQL-to-ClickHouse snapshot synchronization
- **Orchestration:** Docker Compose
- **Benchmarking:** TypeScript/Node.js workload runners

> The current synchronization implementation is a reproducible snapshot synchronization pipeline. It is not being described as production WAL/logical-replication CDC.

## Project objectives

1. Serve point/transaction queries with low latency.
2. Execute analytical workloads on a column-oriented OLAP engine.
3. Run OLTP and OLAP workloads concurrently.
4. Measure P50, P95 and P99 latency rather than relying on theoretical claims.
5. Validate row-count and revenue consistency between PostgreSQL and ClickHouse.
6. Provide reproducible benchmark evidence for the academic project report.

## Dataset

The benchmark dataset currently contains:

| Dataset | Size |
|---|---:|
| PostgreSQL orders | 500,000 |
| PostgreSQL products | 100 |
| ClickHouse fact rows | 1,000,000 |
| Concurrent OLTP requests | 1,000 |
| Concurrent OLAP requests | 20 |

The ClickHouse fact table represents order-item level analytical data.

## Benchmark results

### Concurrent HTAP benchmark

The following measurements were obtained by running:

```powershell
npm --prefix benchmark run concurrent
```

with PostgreSQL OLTP and ClickHouse OLAP workloads running concurrently.

| Metric | OLTP / PostgreSQL | OLAP / ClickHouse |
|---|---:|---:|
| Requests | 1,000 | 20 |
| Average latency | 1541.458 ms | 1179.454 ms |
| P50 latency | 1662.198 ms | 1205.231 ms |
| P95 latency | 2342.076 ms | 1710.834 ms |
| P99 latency | 2414.565 ms | 1803.110 ms |
| Throughput | 410.24 QPS | — |

**Total concurrent duration:** 2437.601 ms  
**Completed requests:** 1,020

These are measured results from the current benchmark run. They should not be interpreted as a guarantee of production performance.

### Isolated OLTP benchmark

A separate point-query benchmark previously measured:

| Metric | Result |
|---|---:|
| Iterations | 1,000 |
| Average latency | 1.763 ms |
| P50 | 1.633 ms |
| P95 | 2.518 ms |
| P99 | 3.856 ms |
| Throughput | 566.49 queries/sec |

The isolated and concurrent results should be kept separate: the concurrent benchmark demonstrates the observed performance impact when analytical workloads execute at the same time.

### Isolated OLAP benchmark

Previously measured analytical query latencies:

| Query | Latency |
|---|---:|
| Total revenue | 25.516 ms |
| Revenue by category | 43.811 ms |
| Daily sales | 102.605 ms |
| Top products | 50.668 ms |
| Customer revenue | 32.348 ms |
| OLAP average | 50.990 ms |

These isolated measurements are separate from the current concurrent benchmark.

## Synchronization validation

The latest PostgreSQL-to-ClickHouse snapshot synchronization validated:

| Check | PostgreSQL | ClickHouse |
|---|---:|---:|
| Rows | 1,000,000 | 1,000,000 |
| Revenue | 1,736,494,898.60 | 1,736,494,898.60 |

Validation:

- **Row count match:** PASS
- **Revenue match:** PASS
- **Consistency:** PASS
- **Synchronization duration:** 27,647.30 ms

## Backend API

The backend exposes:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Backend health check |
| `GET /api/products/:id` | PostgreSQL product lookup |
| `GET /api/analytics/overview` | Analytical overview |
| `GET /api/analytics/revenue-by-category` | Revenue grouped by category |
| `GET /api/analytics/daily-sales` | Daily sales trend |
| `GET /api/analytics/top-products` | Top products by revenue |

## Project structure

```text
htap-ecommerce-system/
├── backend/
│   ├── src/
│   │   ├── db.ts
│   │   └── server.ts
│   └── package.json
├── frontend/
│   ├── src/
│   ├── index.html
│   └── package.json
├── database/
│   ├── postgres/
│   └── clickhouse/
├── cdc/
│   ├── src/
│   │   └── sync.ts
│   └── package.json
├── benchmark/
│   ├── src/
│   │   ├── benchmark.ts
│   │   └── concurrent.ts
│   └── package.json
├── docs/
│   ├── architecture.md
│   └── benchmark-results.md
├── docker-compose.yml
├── .env.example
└── README.md
```

## Running locally

### 1. Start databases

```powershell
docker compose up -d
```

Check status:

```powershell
docker compose ps
```

### 2. Start the backend

```powershell
npm --prefix backend install
npm --prefix backend run dev
```

Backend:

```text
http://localhost:4000
```

### 3. Start the frontend

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

### 4. Run synchronization

```powershell
npm --prefix cdc install
npm --prefix cdc run sync
```

### 5. Run benchmarks

Isolated benchmark:

```powershell
npm --prefix benchmark run benchmark
```

Concurrent HTAP benchmark:

```powershell
npm --prefix benchmark run concurrent
```

## Engineering notes

### Why PostgreSQL + ClickHouse?

PostgreSQL is used for transactional consistency, point lookups and application-facing OLTP operations. ClickHouse is used for aggregation-heavy analytical workloads over the same business data.

### Why snapshot synchronization?

The current project prioritizes a simple, reproducible architecture that can be benchmarked locally. A production implementation could replace or extend the snapshot process with PostgreSQL logical replication/WAL-based CDC and an event transport layer.

### Performance interpretation

The measured data shows that isolated and concurrent workloads behave differently. The project therefore reports both scenarios rather than presenting only the fastest isolated query numbers.

## Limitations

- The current synchronization mechanism is snapshot-based rather than production-grade streaming CDC.
- The benchmark represents a local Docker environment, not a production cluster.
- Concurrent OLTP latency increases substantially compared with isolated point-query measurements.
- No claim of guaranteed sub-second latency is made for the concurrent workload.
- Benchmark results can vary with CPU, memory, Docker configuration, disk performance and background system load.

## Future improvements

- PostgreSQL logical replication/WAL-based CDC.
- Durable event transport for streaming synchronization.
- Incremental synchronization instead of full snapshots.
- Dedicated benchmark environments and repeated statistical runs.
- Connection-pool and query-plan tuning.
- Read replicas or additional OLAP capacity for higher concurrency.
- Automated benchmark result collection and visualization.

## Academic evidence

Detailed benchmark measurements are documented in:

`docs/benchmark-results.md`

The report should use the exact measured values from that document and distinguish isolated benchmarks from concurrent HTAP benchmarks.
