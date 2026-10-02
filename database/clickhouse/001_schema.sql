CREATE DATABASE IF NOT EXISTS htap_analytics;

CREATE TABLE IF NOT EXISTS htap_analytics.fact_orders
(
  order_id UInt64,
  user_id UInt64,
  product_id UInt64,
  quantity UInt32,
  unit_price Decimal(12, 2),
  total_amount Decimal(14, 2),
  status LowCardinality(String),
  category LowCardinality(String),
  order_created_at DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(order_created_at)
ORDER BY (order_created_at, product_id, user_id);
