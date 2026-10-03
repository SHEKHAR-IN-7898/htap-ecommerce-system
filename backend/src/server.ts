import express from "express";
import cors from "cors";
import { query } from "./db.js";

const app = express();

const port = Number(process.env.API_PORT ?? 4000);

const clickhouseUrl =
  process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

const clickhouseDb =
  process.env.CLICKHOUSE_DB ?? "htap_analytics";

app.use(cors());
app.use(express.json());

/**
 * Execute a ClickHouse query and return JSONEachRow results.
 *
 * ClickHouse normally returns TSV/plain text unless a FORMAT
 * clause is specified. We explicitly request JSONEachRow so the
 * backend can safely parse every row.
 */
async function ch<T>(sql: string): Promise<T[]> {
  const url = new URL(clickhouseUrl);

  url.searchParams.set("database", clickhouseDb);
  url.searchParams.set(
    "query",
    `${sql.trim()}\nFORMAT JSONEachRow`,
  );

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `ClickHouse ${response.status}: ${body}`,
    );
  }

  const text = await response.text();

  if (!text.trim()) {
    return [];
  }

  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Health check
 */
app.get("/health", async (_req, res) => {
  try {
    const result = await query<{ now: string }>(
      "SELECT NOW() AS now",
    );

    res.json({
      status: "ok",
      database: "postgresql",
      analytics: "clickhouse",
      timestamp: result.rows[0]?.now,
    });
  } catch (error) {
    console.error("PostgreSQL health check failed:", error);

    res.status(503).json({
      status: "error",
      database: "unavailable",
    });
  }
});

/**
 * OLTP point query
 *
 * PostgreSQL handles transactional/product lookup requests.
 */
app.get("/api/products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid product id",
      });
    }

    const result = await query(
      `
      SELECT
        id,
        name,
        category,
        price,
        stock,
        created_at
      FROM products
      WHERE id = $1
      `,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Product query failed:", error);

    res.status(500).json({
      error: "Database query failed",
    });
  }
});

/**
 * OLAP overview
 *
 * ClickHouse handles analytical aggregation.
 */
app.get("/api/analytics/overview", async (_req, res) => {
  try {
    const rows = await ch<{
      orders: string;
      revenue: string;
      customers: string;
      products: string;
    }>(`
      SELECT
        uniqExact(order_id) AS orders,
        round(sum(total_amount), 2) AS revenue,
        uniqExact(user_id) AS customers,
        uniqExact(product_id) AS products
      FROM fact_orders
    `);

    res.json(
      rows[0] ?? {
        orders: "0",
        revenue: "0",
        customers: "0",
        products: "0",
      },
    );
  } catch (error) {
    console.error("ClickHouse overview failed:", error);

    res.status(503).json({
      error: "ClickHouse analytics unavailable",
    });
  }
});

/**
 * Revenue by category
 */
app.get("/api/analytics/revenue-by-category", async (_req, res) => {
  try {
    const rows = await ch<{
      category: string;
      revenue: string;
    }>(`
      SELECT
        category,
        round(sum(total_amount), 2) AS revenue
      FROM fact_orders
      GROUP BY category
      ORDER BY revenue DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    console.error(
      "ClickHouse revenue-by-category failed:",
      error,
    );

    res.status(503).json({
      error: "ClickHouse analytics unavailable",
    });
  }
});

/**
 * Daily sales
 */
app.get("/api/analytics/daily-sales", async (_req, res) => {
  try {
    const rows = await ch<{
      day: string;
      revenue: string;
    }>(`
      SELECT
        toDate(order_created_at) AS day,
        round(sum(total_amount), 2) AS revenue
      FROM fact_orders
      GROUP BY day
      ORDER BY day
    `);

    res.json(rows);
  } catch (error) {
    console.error("ClickHouse daily-sales failed:", error);

    res.status(503).json({
      error: "ClickHouse analytics unavailable",
    });
  }
});

/**
 * Top products
 */
app.get("/api/analytics/top-products", async (_req, res) => {
  try {
    const rows = await ch<{
      product_id: string;
      revenue: string;
      quantity: string;
    }>(`
      SELECT
        product_id,
        round(sum(total_amount), 2) AS revenue,
        sum(quantity) AS quantity
      FROM fact_orders
      GROUP BY product_id
      ORDER BY revenue DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (error) {
    console.error("ClickHouse top-products failed:", error);

    res.status(503).json({
      error: "ClickHouse analytics unavailable",
    });
  }
});

/**
 * Start server
 */
app.listen(port, () => {
  console.log(
    `HTAP backend listening on http://localhost:${port}`,
  );

  console.log(
    `ClickHouse analytics: ${clickhouseUrl}/${clickhouseDb}`,
  );
});