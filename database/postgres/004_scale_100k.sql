BEGIN;

-- ============================================================
-- HTAP E-COMMERCE 1M ANALYTICAL DATASET
-- 500,000 orders
-- 1,000,000 order_items
-- 100 users
-- 100 products
-- ============================================================

TRUNCATE TABLE order_items, orders RESTART IDENTITY CASCADE;

-- ============================================================
-- 1. Generate 500,000 orders
-- ============================================================

INSERT INTO orders (
    user_id,
    status,
    total_amount,
    created_at
)
SELECT
    1 + floor(random() * 100)::int,

    CASE
        WHEN random() < 0.70 THEN 'completed'
        WHEN random() < 0.85 THEN 'pending'
        WHEN random() < 0.95 THEN 'shipped'
        ELSE 'cancelled'
    END,

    0,

    NOW() - (random() * INTERVAL '365 days')

FROM generate_series(1, 500000);


-- ============================================================
-- 2. Generate 2 products/items per order
--    = 1,000,000 order_items
--
-- IMPORTANT:
-- Product selection is independently randomized for every row.
-- ============================================================

INSERT INTO order_items (
    order_id,
    product_id,
    quantity,
    unit_price
)
SELECT
    o.id,
    r.product_id,
    1 + floor(random() * 5)::int,
    p.price

FROM orders o

CROSS JOIN LATERAL (
    SELECT
        1 + floor(random() * 100)::int AS product_id
) r

JOIN products p
    ON p.id = r.product_id

CROSS JOIN generate_series(1, 2);


-- ============================================================
-- 3. Recalculate order totals
-- ============================================================

UPDATE orders o
SET total_amount = x.total
FROM (
    SELECT
        order_id,
        ROUND(
            SUM(quantity * unit_price)::numeric,
            2
        ) AS total
    FROM order_items
    GROUP BY order_id
) x
WHERE o.id = x.order_id;


COMMIT;


-- ============================================================
-- 4. Refresh PostgreSQL statistics
-- ============================================================

ANALYZE orders;
ANALYZE order_items;


-- ============================================================
-- 5. Verification
-- ============================================================

SELECT
    COUNT(*) AS orders
FROM orders;

SELECT
    COUNT(*) AS order_items
FROM order_items;

SELECT
    COUNT(DISTINCT product_id) AS distinct_products
FROM order_items;

SELECT
    COUNT(DISTINCT user_id) AS distinct_customers
FROM orders;

SELECT
    COUNT(*) AS invalid_orders
FROM orders
WHERE total_amount <= 0;