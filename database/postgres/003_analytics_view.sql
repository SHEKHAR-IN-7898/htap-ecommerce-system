CREATE OR REPLACE VIEW order_analytics_source AS
SELECT
  oi.order_id,
  o.user_id,
  oi.product_id,
  oi.quantity,
  oi.unit_price,
  ROUND((oi.quantity * oi.unit_price)::numeric, 2) AS total_amount,
  o.status,
  p.category,
  o.created_at AS order_created_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id;
