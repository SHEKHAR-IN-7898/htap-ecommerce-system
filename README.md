# HTAP E-Commerce System

A full-stack Hybrid Transactional/Analytical Processing (HTAP) system designed to serve fast OLTP operations and analytical OLAP workloads from the same continuously synchronized business dataset.

## Architecture

- **Frontend:** React + Vite
- **Backend:** Node.js + Express + TypeScript
- **OLTP:** PostgreSQL
- **OLAP:** ClickHouse
- **Synchronization:** CDC/event pipeline (to be implemented)
- **Local orchestration:** Docker Compose

```
React
  |
  v
Express API
  |----------------------|
  v                      v
PostgreSQL           ClickHouse
  |                      ^
  |---- CDC / Sync ------|
```

## Project goals

1. Keep point/transaction queries below the sub-second target.
2. Support complex analytical queries without making OLTP compete with OLAP.
3. Measure P50/P95/P99 OLTP latency under analytical load.
4. Measure synchronization lag and validate data consistency.
5. Produce reproducible benchmarks for the academic report.

## Status

Phase 1: repository and architecture foundation.

No benchmark result in this repository should be treated as final until measured from the implemented system.

## Project structure

```
backend/       API and application services
frontend/      React application
database/      PostgreSQL and ClickHouse schemas/seeds
cdc/           synchronization pipeline
benchmarks/    workload generators and performance tests
docs/          architecture and report evidence
```
