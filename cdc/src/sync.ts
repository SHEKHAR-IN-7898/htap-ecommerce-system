import "dotenv/config";
import pg from "pg";
import { createClient } from "@clickhouse/client";

const { Pool } = pg;

type SourceRow = {
  order_id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
  status: string;
  category: string;
  order_created_at: string;
};

const pgPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://htap:change_me@localhost:5432/htap",
});

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DB ?? "htap_analytics",
});

function toClickHouseRow(row: SourceRow) {
  return {
    order_id: Number(row.order_id),
    user_id: Number(row.user_id),
    product_id: Number(row.product_id),
    quantity: Number(row.quantity),
    unit_price: row.unit_price,
    total_amount: row.total_amount,
    status: row.status,
    category: row.category,
    order_created_at: new Date(row.order_created_at)
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
  };
}

async function queryClickHouse<T>(query: string): Promise<T[]> {
  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
  });
  return result.json<T[]>();
}

async function main() {
  const startedAt = performance.now();

  const source = await pgPool.query<SourceRow>(`
    SELECT
      order_id,
      user_id,
      product_id,
      quantity,
      unit_price,
      total_amount,
      status,
      category,
      order_created_at
    FROM order_analytics_source
    ORDER BY order_id, product_id
  `);

  console.log(`Source rows: ${source.rowCount ?? source.rows.length}`);

  await clickhouse.command({
    query: "CREATE DATABASE IF NOT EXISTS htap_analytics",
  });

  await clickhouse.command({
    query: `
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
      ORDER BY (order_created_at, product_id, user_id)
    `,
  });

  // Phase 1 is a full snapshot. Truncating first makes repeated development
  // runs deterministic and prevents duplicate facts.
  await clickhouse.command({
    query: "TRUNCATE TABLE htap_analytics.fact_orders",
  });

  const rows = source.rows.map(toClickHouseRow);

  if (rows.length > 0) {
    await clickhouse.insert({
      table: "htap_analytics.fact_orders",
      values: rows,
      format: "JSONEachRow",
    });
  }

  const destination = await queryClickHouse<{ count: string; total: string }>(`
    SELECT
      toString(count()) AS count,
      toString(sum(total_amount)) AS total
    FROM htap_analytics.fact_orders
  `);

  const sourceCheck = await pgPool.query<{ count: string; total: string }>(`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(ROUND(SUM(total_amount), 2), 0)::text AS total
    FROM order_analytics_source
  `);

  const sourceCount = sourceCheck.rows[0]?.count ?? "0";
  const sourceTotal = sourceCheck.rows[0]?.total ?? "0";
  const destinationCount = destination[0]?.count ?? "0";
  const destinationTotal = destination[0]?.total ?? "0";

  const consistent =
    sourceCount === destinationCount &&
    Number(sourceTotal).toFixed(2) === Number(destinationTotal).toFixed(2);

  const elapsedMs = performance.now() - startedAt;

  console.log(`Destination rows: ${destinationCount}`);
  console.log(`Source revenue: ${Number(sourceTotal).toFixed(2)}`);
  console.log(`Destination revenue: ${Number(destinationTotal).toFixed(2)}`);
  console.log(`Consistency: ${consistent ? "PASS" : "FAIL"}`);
  console.log(`Sync duration: ${elapsedMs.toFixed(2)} ms`);

  if (!consistent) {
    throw new Error("PostgreSQL and ClickHouse consistency check failed.");
  }
}

main()
  .catch((error) => {
    console.error("Synchronization failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
    await clickhouse.close();
  });
