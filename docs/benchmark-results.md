# HTAP Benchmark Results

## 1. Purpose

This document records the measured performance and synchronization results of the HTAP E-Commerce System.

The benchmark evaluates:

- PostgreSQL OLTP point-query performance.
- ClickHouse OLAP analytical-query performance.
- Concurrent OLTP + OLAP workload behavior.
- PostgreSQL-to-ClickHouse data consistency.

All latency values in this document are measured results from the local project environment. They are not production guarantees.

## 2. Test dataset

| Dataset | Value |
|---|---:|
| PostgreSQL orders | 500,000 |
| PostgreSQL products | 100 |
| ClickHouse fact rows | 1,000,000 |
| Concurrent OLTP requests | 1,000 |
| Concurrent OLAP requests | 20 |
| Total concurrent requests | 1,020 |

## 3. Concurrent HTAP benchmark

Command executed from the project root:

```powershell
npm --prefix benchmark run concurrent
```

The benchmark warmed up the database connections and then ran PostgreSQL OLTP requests and ClickHouse OLAP requests concurrently.

### OLTP results

| Metric | Measured result |
|---|---:|
| Requests | 1,000 |
| Average | 1541.458 ms |
| P50 | 1662.198 ms |
| P95 | 2342.076 ms |
| P99 | 2414.565 ms |
| Throughput | 410.24 QPS |

### OLAP results

| Metric | Measured result |
|---|---:|
| Requests | 20 |
| Average | 1179.454 ms |
| P50 | 1205.231 ms |
| P95 | 1710.834 ms |
| P99 | 1803.110 ms |

### Overall

| Metric | Result |
|---|---:|
| Total concurrent duration | 2437.601 ms |
| Total completed requests | 1,020 |
| Benchmark status | Completed successfully |

## 4. Isolated OLTP benchmark

A separate isolated point-query benchmark produced:

| Metric | Result |
|---|---:|
| Iterations | 1,000 |
| Average | 1.763 ms |
| P50 | 1.633 ms |
| P95 | 2.518 ms |
| P99 | 3.856 ms |
| Throughput | 566.49 queries/sec |

This result represents the isolated workload and must not be substituted for the concurrent HTAP result.

## 5. Isolated OLAP benchmark

Previously measured analytical queries produced:

| Query | Latency |
|---|---:|
| Total revenue | 25.516 ms |
| Revenue by category | 43.811 ms |
| Daily sales | 102.605 ms |
| Top products | 50.668 ms |
| Customer revenue | 32.348 ms |
| OLAP average | 50.990 ms |
| OLAP total | 254.948 ms |

These values describe isolated analytical execution and are separate from the concurrent measurements in Section 3.

## 6. Synchronization validation

The latest PostgreSQL-to-ClickHouse snapshot synchronization processed 1,000,000 source rows.

| Validation metric | PostgreSQL | ClickHouse |
|---|---:|---:|
| Row count | 1,000,000 | 1,000,000 |
| Revenue | 1,736,494,898.60 | 1,736,494,898.60 |

### Validation status

- Row count match: **PASS**
- Revenue match: **PASS**
- Overall consistency: **PASS**
- Synchronization duration: **27,647.30 ms**

The identical row counts and revenue totals provide a basic consistency check for the synchronized analytical dataset.

## 7. Interpretation

The isolated benchmark demonstrates that PostgreSQL point queries can be very fast under low contention in the tested local environment.

The concurrent benchmark shows a different behavior: while PostgreSQL OLTP and ClickHouse OLAP are separated at the database layer, the workloads still share the underlying host resources. Under the measured concurrent workload, OLTP P95 latency was 2342.076 ms and OLAP P95 latency was 1710.834 ms.

Therefore, the results should be interpreted as evidence of the behavior of this particular Docker-based test environment, not as a universal performance guarantee.

The key experimental comparison is between isolated and concurrent execution. This provides evidence for discussing workload interference, resource contention and the benefits and limitations of separating OLTP and OLAP engines.

## 8. Reproducibility

From the repository root:

```powershell
docker compose up -d
npm --prefix cdc run sync
npm --prefix benchmark run benchmark
npm --prefix benchmark run concurrent
```

The benchmark environment should be kept consistent when comparing future runs.

## 9. Limitations

- Snapshot synchronization is not equivalent to production streaming CDC.
- Results were collected on a local Docker environment.
- Results may vary with CPU, RAM, storage, Docker/WSL configuration and background load.
- Only one reported concurrent run is recorded here; repeated runs would provide stronger statistical confidence.
- The concurrent benchmark is intentionally reported as measured rather than being converted into a claim that the system always meets a sub-second SLA.

## 10. Recommended report usage

For the academic report:

- Use the isolated OLTP results to describe baseline point-query performance.
- Use the isolated OLAP results to describe baseline analytical performance.
- Use the concurrent results to evaluate mixed workload behavior.
- Use the synchronization results to demonstrate data consistency.
- Do not replace measured concurrent latency with the faster isolated values.
