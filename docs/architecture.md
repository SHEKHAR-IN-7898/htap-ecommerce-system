# HTAP Architecture

## Workload separation

### OLTP
PostgreSQL owns transactional writes and point reads:

- users
- products
- orders
- order_items

### OLAP
ClickHouse owns analytical reads over a denormalized fact table.

### Synchronization
The planned data path is:

PostgreSQL -> CDC/event stream -> ClickHouse

The synchronization implementation is intentionally not claimed as complete yet.

## Performance requirement

The assignment requires sub-second response times for point queries. We will measure:

- P50
- P95
- P99
- throughput
- synchronization lag

Results will be recorded only after benchmark execution.
