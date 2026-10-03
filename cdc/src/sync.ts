import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { createClient } from "@clickhouse/client";

const { Pool } = pg;

// ============================================================
// Load project-root .env
//
// cdc/src/sync.ts
//       ↑
//       └── ../../.env
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
// PostgreSQL
// ============================================================

const pool = new Pool({
  connectionString: databaseUrl,
});

// ============================================================
// ClickHouse
// ============================================================

const clickhouse = createClient({
  url: clickhouseUrl,
  username: clickhouseUser,
  password: clickhousePassword,
  database: clickhouseDb,
});

// ============================================================
// Types
// ============================================================

type SourceRow = {
  order_id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  unit_price: string | number;
  total_amount: string | number;
  status: string;
  category: string;
  order_created_at: Date | string;
};

// ============================================================
// Main synchronization
// ============================================================

async function sync(): Promise<void> {
  const startedAt = Date.now();

  console.log("============================================================");
  console.log("HTAP SNAPSHOT SYNCHRONIZATION");
  console.log("PostgreSQL → ClickHouse");
  console.log("============================================================");

  try {
    // ----------------------------------------------------------
    // 1. Read PostgreSQL source data
    // ----------------------------------------------------------

    console.log("\n[1/5] Reading PostgreSQL source data...");

    const sourceResult = await pool.query<SourceRow>(`
      SELECT
        oi.order_id,
        o.user_id,
        oi.product_id,
        oi.quantity,
        oi.unit_price,
        ROUND(
          (oi.quantity * oi.unit_price)::numeric,
          2
        ) AS total_amount,
        o.status,
        p.category,
        o.created_at AS order_created_at
      FROM order_items oi
      JOIN orders o
        ON o.id = oi.order_id
      JOIN products p
        ON p.id = oi.product_id
      ORDER BY oi.order_id;
    `);

    const rows = sourceResult.rows;

    console.log(`PostgreSQL source rows: ${rows.length}`);

    if (rows.length === 0) {
      throw new Error("PostgreSQL returned zero source rows.");
    }

    // ----------------------------------------------------------
    // 2. Clear ClickHouse destination
    // ----------------------------------------------------------

    console.log("\n[2/5] Preparing ClickHouse destination...");

    await clickhouse.command({
      query: `
        TRUNCATE TABLE ${clickhouseDb}.fact_orders
      `,
    });

    console.log("ClickHouse destination cleared.");

    // ----------------------------------------------------------
    // 3. Insert snapshot into ClickHouse
    // ----------------------------------------------------------

    console.log("\n[3/5] Synchronizing data to ClickHouse...");

    const clickhouseRows = rows.map((row) => ({
      order_id: Number(row.order_id),
      user_id: Number(row.user_id),
      product_id: Number(row.product_id),
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      total_amount: Number(row.total_amount),
      status: row.status,
      category: row.category,
      order_created_at:
        row.order_created_at instanceof Date
          ? row.order_created_at.toISOString().slice(0, 19).replace("T", " ")
          : String(row.order_created_at).replace("T", " ").slice(0, 19),
    }));

    await clickhouse.insert({
      table: `${clickhouseDb}.fact_orders`,
      values: clickhouseRows,
      format: "JSONEachRow",
    });

    console.log("ClickHouse insert completed.");

    // ----------------------------------------------------------
    // 4. Verify row count and revenue
    // ----------------------------------------------------------

    console.log("\n[4/5] Verifying synchronization...");

    const pgCountResult = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM order_items;
    `);

    const pgRevenueResult = await pool.query<{ revenue: string }>(`
      SELECT
        ROUND(
          SUM(quantity * unit_price)::numeric,
          2
        )::text AS revenue
      FROM order_items;
    `);

    const chCountResult = await clickhouse.query({
      query: `
        SELECT count() AS count
        FROM ${clickhouseDb}.fact_orders
      `,
      format: "JSONEachRow",
    });

    const chRevenueResult = await clickhouse.query({
      query: `
        SELECT
          round(
            sum(toDecimal64(total_amount, 2)),
            2
          ) AS revenue
        FROM ${clickhouseDb}.fact_orders
      `,
      format: "JSONEachRow",
    });

    const chCountRows = await chCountResult.json<{
      count: string | number;
    }>();

    const chRevenueRows = await chRevenueResult.json<{
      revenue: string | number;
    }>();

    const postgresRows = Number(pgCountResult.rows[0]?.count ?? 0);
    const clickhouseRowsCount = Number(
      chCountRows[0]?.count ?? 0,
    );

    const postgresRevenue = Number(
      pgRevenueResult.rows[0]?.revenue ?? 0,
    );

    const clickhouseRevenue = Number(
      chRevenueRows[0]?.revenue ?? 0,
    );

    const rowCountMatch =
      postgresRows === clickhouseRowsCount;

    const revenueMatch =
      Math.abs(postgresRevenue - clickhouseRevenue) < 0.01;

    console.log(`PostgreSQL rows : ${postgresRows}`);
    console.log(`ClickHouse rows : ${clickhouseRowsCount}`);

    console.log(
      `PostgreSQL revenue : ${postgresRevenue.toFixed(2)}`,
    );

    console.log(
      `ClickHouse revenue : ${clickhouseRevenue.toFixed(2)}`,
    );

    console.log(
      `Row count match : ${rowCountMatch ? "PASS" : "FAIL"}`,
    );

    console.log(
      `Revenue match   : ${revenueMatch ? "PASS" : "FAIL"}`,
    );

    if (!rowCountMatch || !revenueMatch) {
      throw new Error(
        "Synchronization verification failed.",
      );
    }

    // ----------------------------------------------------------
    // 5. Final result
    // ----------------------------------------------------------

    const duration = Date.now() - startedAt;

    console.log("\n[5/5] Synchronization completed.");

    console.log("\n============================================================");
    console.log("SYNCHRONIZATION RESULT");
    console.log("============================================================");
    console.log(`Source rows       : ${postgresRows}`);
    console.log(`Destination rows  : ${clickhouseRowsCount}`);
    console.log(
      `Revenue match     : ${revenueMatch ? "PASS" : "FAIL"}`,
    );
    console.log(
      `Row count match   : ${rowCountMatch ? "PASS" : "FAIL"}`,
    );
    console.log(`Duration          : ${duration} ms`);
    console.log("Status            : PASS");
    console.log("============================================================");
  } catch (error) {
    console.error("\n============================================================");
    console.error("SYNCHRONIZATION FAILED");
    console.error("============================================================");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  } finally {
    await pool.end();
    await clickhouse.close();
  }
}

// ============================================================
// Run
// ============================================================

sync();