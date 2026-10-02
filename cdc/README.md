# CDC / Synchronization

The target data flow is:

PostgreSQL -> change capture -> ClickHouse

## Phase 1

The first implementation will use a deterministic batch synchronization script. This gives us:

- a simple reproducible development environment
- explicit row-count and checksum validation
- a clear baseline before introducing streaming CDC

## Contract

The synchronization process must:

1. Read the OLAP source rows from PostgreSQL.
2. Load them into ClickHouse.
3. Be safe to re-run for a clean development database.
4. Report source row count and destination row count.
5. Report a consistency check.

Streaming CDC can replace this mechanism after the baseline is proven.
