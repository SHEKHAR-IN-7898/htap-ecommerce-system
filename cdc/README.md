# CDC / Synchronization

The target data flow is:

```
PostgreSQL -> synchronization -> ClickHouse
```

## Phase 1: deterministic snapshot synchronization

The first implementation intentionally uses a full snapshot instead of Kafka or another streaming platform. This gives us a reproducible baseline and lets us prove the data contract before adding operational complexity.

The script:

1. Reads the denormalized `order_analytics_source` view from PostgreSQL.
2. Creates the ClickHouse database/table if needed.
3. Truncates the ClickHouse fact table for a deterministic development run.
4. Inserts the current PostgreSQL snapshot into ClickHouse.
5. Compares source/destination row counts.
6. Compares source/destination total revenue.
7. Reports synchronization duration.

This is **snapshot synchronization, not production CDC**. It is deliberately the first milestone.

## Run

Start PostgreSQL and ClickHouse:

```bash
docker compose up -d
```

Install dependencies:

```bash
cd cdc
npm install
```

Run the synchronization:

```npm
npm run sync
```

Expected successful output is similar to:

```
Source rows: 2000
Destination rows: 2000
Source revenue: ...
Destination revenue: ...
Consistency: PASS
Sync duration: ... ms
```

The exact numbers and duration must come from the actual local run and are not treated as benchmark results until measured.

## Why snapshot first?

A streaming CDC pipeline adds failure modes such as offsets, retries, duplicate events, schema evolution, and recovery after downtime. We first establish:

- correct source-to-warehouse mapping
- repeatable synchronization
- data consistency checks
- a measurable synchronization duration

After this baseline is working, the next CDC milestone can be incremental synchronization based on PostgreSQL changes.

## Environment

The script uses the following defaults when variables are not supplied:

```env
DATABASE_URL=postgresql://htap:change_me@localhost:5432/htap
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DB=htap_analytics
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```
