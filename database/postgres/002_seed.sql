INSERT INTO users (name, email, password_hash)
SELECT 'Customer ' || g, 'customer' || g || '@example.com', 'demo-hash'
FROM generate_series(1, 100) AS g
ON CONFLICT (email) DO NOTHING;

INSERT INTO products (name, category, price, stock)
SELECT 'Product ' || g,
  CASE ((g - 1) % 5)
    WHEN 0 THEN 'Electronics'
    WHEN 1 THEN 'Home'
    WHEN 2 THEN 'Books'
    WHEN 3 THEN 'Sports'
    ELSE 'Fashion'
  END,
  ROUND((20 + (g * 7.35))::numeric, 2),
  50 + ((g * 13) % 200)
FROM generate_series(1, 100) AS g
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);

INSERT INTO orders (user_id, status, total_amount, created_at)
SELECT ((g - 1) % 100) + 1,
  CASE WHEN g % 20 = 0 THEN 'CANCELLED' WHEN g % 10 = 0 THEN 'SHIPPED' ELSE 'COMPLETED' END,
  0,
  NOW() - ((g % 90) || ' days')::interval
FROM generate_series(1, 1000) AS g
WHERE NOT EXISTS (SELECT 1 FROM orders LIMIT 1);

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, ((o.id + s.n - 2) % 100) + 1, 1 + ((o.id + s.n) % 4), p.price
FROM orders o
CROSS JOIN generate_series(1, 2) AS s(n)
JOIN products p ON p.id = ((o.id + s.n - 2) % 100) + 1
WHERE NOT EXISTS (SELECT 1 FROM order_items LIMIT 1);

UPDATE orders o
SET total_amount = totals.total
FROM (
  SELECT order_id, ROUND(SUM(quantity * unit_price), 2) AS total
  FROM order_items
  GROUP BY order_id
) totals
WHERE o.id = totals.order_id;