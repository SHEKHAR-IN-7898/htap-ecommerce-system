import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://htap:htap123@localhost:5433/htap";

const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

const CLICKHOUSE_DB =
  process.env.CLICKHOUSE_DB ?? "htap_analytics";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

type Sample = {
  average: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);

  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function summarize(values: number[], totalMs: number): Sample {
  const average =
    values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    average,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    throughput: (values.length / totalMs) * 1000,
  };
}

async function clickhouseQuery<T>(
  sql: string,
): Promise<T[]> {
  const url = new URL(CLICKHOUSE_URL);

  url.searchParams.set("database", CLICKHOUSE_DB);
  url.searchParams.set(
    "query",
    `${sql.trim()}\nFORMAT JSONEachRow`,
  );

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `ClickHouse ${response.status}: ${await response.text()}`,
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

async function measurePostgresPointQueries(
  iterations = 1000,
): Promise<Sample> {
  const times: number[] = [];

  const maxResult = await pool.query<{ max_id: number }>(
    "SELECT MAX(id)::int AS max_id FROM orders",
  );

  const maxId = maxResult.rows[0]?.max_id ?? 1;

  console.log(`PostgreSQL max order id: ${maxId}`);

  const started = performance.now();

  for (let i = 0; i < iterations; i++) {
    const orderId = 1 + (i % maxId);

    const queryStarted = performance.now();

    await pool.query(
      `
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.total_amount,
        o.created_at
      FROM orders o
      WHERE o.id = $1
      `,
      [orderId],
    );

    times.push(performance.now() - queryStarted);
  }

  const totalMs = performance.now() - started;

  return summarize(times, totalMs);
}

async function measureClickHouseQuery(
  name: string,
  sql: string,
): Promise<number> {
  const started = performance.now();

  await clickhouseQuery(sql);

  const duration = performance.now() - started;

  console.log(
    `${name.padEnd(24)} ${duration.toFixed(3)} ms`,
  );

  return duration;
}

async function main() {
  console.log("");
  console.log("==============================================");
  console.log("        HTAP SYSTEM BENCHMARK");
  console.log("==============================================");
  console.log("");

  const pgCount = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM orders",
  );

  const pgProducts = await pool.query<{ count: string }>(
    "SELECT COUNT(DISTINCT product_id)::text AS count FROM order_items",
  );

  const chCount = await clickhouseQuery<{ count: string }>(
    "SELECT count() AS count FROM fact_orders",
  );

  console.log(
    `PostgreSQL orders       : ${pgCount.rows[0]?.count}`,
  );

  console.log(
    `PostgreSQL products     : ${pgProducts.rows[0]?.count}`,
  );

  console.log(
    `ClickHouse fact rows    : ${chCount[0]?.count}`,
  );

  console.log("");

  // --------------------------------------------------
  // OLTP
  // --------------------------------------------------

  console.log("OLTP POINT-QUERY BENCHMARK");
  console.log("----------------------------------------------");

  const oltp = await measurePostgresPointQueries(1000);

  console.log(`Iterations : 1000`);
  console.log(`Average    : ${oltp.average.toFixed(3)} ms`);
  console.log(`P50        : ${oltp.p50.toFixed(3)} ms`);
  console.log(`P95        : ${oltp.p95.toFixed(3)} ms`);
  console.log(`P99        : ${oltp.p99.toFixed(3)} ms`);
  console.log(`Throughput : ${oltp.throughput.toFixed(2)} queries/sec`);

  console.log("");

  // --------------------------------------------------
  // OLAP
  // --------------------------------------------------

  console.log("OLAP ANALYTICAL QUERIES");
  console.log("----------------------------------------------");

  const queries = [
    {
      name: "Total revenue",
      sql: `
        SELECT
          sum(total_amount) AS revenue
        FROM fact_orders
      `,
    },
    {
      name: "Revenue by category",
      sql: `
        SELECT
          category,
          sum(total_amount) AS revenue
        FROM fact_orders
        GROUP BY category
        ORDER BY revenue DESC
      `,
    },
    {
      name: "Daily sales",
      sql: `
        SELECT
          toDate(order_created_at) AS sale_date,
          sum(total_amount) AS revenue,
          count() AS orders
        FROM fact_orders
        GROUP BY sale_date
        ORDER BY sale_date
      `,
    },
    {
      name: "Top products",
      sql: `
        SELECT
          product_id,
          sum(total_amount) AS revenue,
          sum(quantity) AS quantity
        FROM fact_orders
        GROUP BY product_id
        ORDER BY revenue DESC
        LIMIT 10
      `,
    },
    {
      name: "Customer revenue",
      sql: `
        SELECT
          user_id,
          sum(total_amount) AS revenue
        FROM fact_orders
        GROUP BY user_id
        ORDER BY revenue DESC
        LIMIT 100
      `,
    },
  ];

  const olapTimes: number[] = [];

  for (const query of queries) {
    olapTimes.push(
      await measureClickHouseQuery(
        query.name,
        query.sql,
      ),
    );
  }

  const olapTotal = olapTimes.reduce(
    (sum, value) => sum + value,
    0,
  );

  const olapAverage =
    olapTimes.length > 0
      ? olapTotal / olapTimes.length
      : 0;

  console.log("");
  console.log(
    `OLAP average : ${olapAverage.toFixed(3)} ms`,
  );

  console.log(
    `OLAP total   : ${olapTotal.toFixed(3)} ms`,
  );

  console.log("");

  console.log("==============================================");
  console.log("Benchmark completed successfully.");
  console.log("==============================================");
  console.log("");

  await pool.end();
}

main().catch(async (error) => {
  console.error("");
  console.error("Benchmark failed:");
  console.error(error);
  console.error("");

  await pool.end();
  process.exit(1);
});
