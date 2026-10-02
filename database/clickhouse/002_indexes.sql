ALTER TABLE htap_analytics.fact_orders
  ADD INDEX IF NOT EXISTS idx_status status TYPE set(10) GRANULARITY 4;

ALTER TABLE htap_analytics.fact_orders
  ADD INDEX IF NOT EXISTS idx_category category TYPE set(20) GRANULARITY 4;
