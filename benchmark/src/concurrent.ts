import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { createClient } from "@clickhouse/client";

const { Pool } = pg;

// ============================================================
// Load project-root .env
//
// benchmark/src/concurrent.ts
//             ↑
//             └── ../../.env
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

// ============================================================
// Configuration
// ============================================================

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Configure it in the project-root .env file.",
  );
}

const clickhouseUrl =
  process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

const clickhouseDb =
  process.env.CLICKHOUSE_DB ?? "htap_analytics";

const clickhouseUser =
  process.env.CLICKHOUSE_USER ?? "default";

const clickhousePassword =
  process.env.CLICKHOUSE_PASSWORD ?? "";

// ============================================================
// Clients
// ============================================================

const pool = new Pool({
  connectionString: databaseUrl,
});

const clickhouse = createClient({
  url: clickhouseUrl,
  username: clickhouseUser,
  password: clickhousePassword,
  database: clickhouseDb,
});

// ============================================================
// Benchmark configuration
// ============================================================

const OLTP_REQUESTS = 1000;
const OLAP_REQUESTS = 20;

// ============================================================
// Helpers
// ============================================================

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.max(0, index)];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`;
}

// ============================================================
// PostgreSQL OLTP point query
// ============================================================

async function runOltpQuery(): Promise<number> {
  const orderId =
    1 + Math.floor(Math.random() * 500000);

  const start = performance.now();

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
      LIMIT 1;
    `,
    [orderId],
  );

  return performance.now() - start;
}

// ============================================================
// ClickHouse OLAP query
// ============================================================

async function runOlapQuery(): Promise<number> {
  const queries = [
    `
      SELECT
        round(sum(total_amount), 2) AS revenue
      FROM ${clickhouseDb}.fact_orders
    `,

    `
      SELECT
        category,
        round(sum(total_amount), 2) AS revenue
      FROM ${clickhouseDb}.fact_orders
      GROUP BY category
      ORDER BY revenue DESC
    `,

    `
      SELECT
        toDate(order_created_at) AS day,
        round(sum(total_amount), 2) AS revenue
      FROM ${clickhouseDb}.fact_orders
      GROUP BY day
      ORDER BY day
    `,

    `
      SELECT
        product_id,
        sum(quantity) AS units,
        round(sum(total_amount), 2) AS revenue
      FROM ${clickhouseDb}.fact_orders
      GROUP BY product_id
      ORDER BY revenue DESC
      LIMIT 10
    `,

    `
      SELECT
        user_id,
        round(sum(total_amount), 2) AS revenue
      FROM ${clickhouseDb}.fact_orders
      GROUP BY user_id
      ORDER BY revenue DESC
      LIMIT 20
    `,
  ];

  const sql =
    queries[Math.floor(Math.random() * queries.length)];

  const start = performance.now();

  const result = await clickhouse.query({
    query: sql,
    format: "JSONEachRow",
  });

  await result.json();

  return performance.now() - start;
}

// ============================================================
// Concurrent benchmark
// ============================================================

async function runBenchmark(): Promise<void> {
  console.log("");
  console.log("============================================================");
  console.log("CONCURRENT HTAP BENCHMARK");
  console.log("============================================================");

  // ----------------------------------------------------------
  // Dataset information
  // ----------------------------------------------------------

  const orderCountResult = await pool.query<{
    count: string;
  }>(`
    SELECT COUNT(*)::text AS count
    FROM orders;
  `);

  const clickhouseCountResult = await clickhouse.query({
    query: `
      SELECT count() AS count
      FROM ${clickhouseDb}.fact_orders
    `,
    format: "JSONEachRow",
  });

  const clickhouseCountRows =
    await clickhouseCountResult.json<{
      count: string | number;
    }>();

  const postgresOrders = Number(
    orderCountResult.rows[0]?.count ?? 0,
  );

  const clickhouseRows = Number(
    clickhouseCountRows[0]?.count ?? 0,
  );

  console.log(
    `PostgreSQL orders    : ${postgresOrders}`,
  );

  console.log(
    `ClickHouse fact rows : ${clickhouseRows}`,
  );

  console.log(
    `OLTP requests        : ${OLTP_REQUESTS}`,
  );

  console.log(
    `OLAP requests        : ${OLAP_REQUESTS}`,
  );

  // ----------------------------------------------------------
  // Warm-up
  // ----------------------------------------------------------

  console.log("");
  console.log("Warming up connections...");

  await runOltpQuery();
  await runOlapQuery();

  // ----------------------------------------------------------
  // Start concurrent workload
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "Running PostgreSQL OLTP and ClickHouse OLAP concurrently...",
  );

  const startedAt = performance.now();

  const oltpPromises = Array.from(
    { length: OLTP_REQUESTS },
    () => runOltpQuery(),
  );

  const olapPromises = Array.from(
    { length: OLAP_REQUESTS },
    () => runOlapQuery(),
  );

  const [oltpResults, olapResults] =
    await Promise.all([
      Promise.all(oltpPromises),
      Promise.all(olapPromises),
    ]);

  const totalDuration =
    performance.now() - startedAt;

  // ----------------------------------------------------------
  // OLTP metrics
  // ----------------------------------------------------------

  const oltpAverage = average(oltpResults);
  const oltpP50 = percentile(oltpResults, 50);
  const oltpP95 = percentile(oltpResults, 95);
  const oltpP99 = percentile(oltpResults, 99);

  const oltpQps =
    OLTP_REQUESTS / (totalDuration / 1000);

  // ----------------------------------------------------------
  // OLAP metrics
  // ----------------------------------------------------------

  const olapAverage = average(olapResults);
  const olapP50 = percentile(olapResults, 50);
  const olapP95 = percentile(olapResults, 95);
  const olapP99 = percentile(olapResults, 99);

  // ----------------------------------------------------------
  // Results
  // ----------------------------------------------------------

  console.log("");
  console.log("============================================================");
  console.log("OLTP RESULTS");
  console.log("============================================================");

  console.log(
    `Average    : ${formatMs(oltpAverage)}`,
  );

  console.log(
    `P50        : ${formatMs(oltpP50)}`,
  );

  console.log(
    `P95        : ${formatMs(oltpP95)}`,
  );

  console.log(
    `P99        : ${formatMs(oltpP99)}`,
  );

  console.log(
    `Throughput : ${oltpQps.toFixed(2)} QPS`,
  );

  console.log("");
  console.log("============================================================");
  console.log("OLAP RESULTS");
  console.log("============================================================");

  console.log(
    `Average    : ${formatMs(olapAverage)}`,
  );

  console.log(
    `P50        : ${formatMs(olapP50)}`,
  );

  console.log(
    `P95        : ${formatMs(olapP95)}`,
  );

  console.log(
    `P99        : ${formatMs(olapP99)}`,
  );

  console.log("");
  console.log("============================================================");
  console.log("OVERALL");
  console.log("============================================================");

  console.log(
    `Total concurrent duration : ${formatMs(totalDuration)}`,
  );

  console.log(
    `Total completed requests  : ${
      OLTP_REQUESTS + OLAP_REQUESTS
    }`,
  );

  console.log("");
  console.log("Benchmark completed successfully.");
  console.log("============================================================");
}

// ============================================================
// Run
// ============================================================

runBenchmark()
  .catch((error) => {
    console.error("");
    console.error("============================================================");
    console.error("CONCURRENT BENCHMARK FAILED");
    console.error("============================================================");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await clickhouse.close();
  });