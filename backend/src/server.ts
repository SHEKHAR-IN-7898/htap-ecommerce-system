import "dotenv/config";
import express from "express";
import cors from "cors";
import { query } from "./db.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const clickhouseDb = process.env.CLICKHOUSE_DB ?? "htap_analytics";

app.use(cors());
app.use(express.json());

async function ch<T>(sql: string): Promise<T[]> {
  const url = new URL(clickhouseUrl);
  url.searchParams.set("database", clickhouseDb);
  url.searchParams.set("query", sql.trim());
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) throw new Error(`ClickHouse ${response.status}: ${await response.text()}`);
  const body = await response.json() as { data?: T[] };
  return body.data ?? [];
}

app.get("/health", async (_req, res) => {
  try {
    const result = await query<{ now: string }>("SELECT NOW() AS now");
    res.json({ status: "ok", database: "postgresql", analytics: "clickhouse", timestamp: result.rows[0]?.now });
  } catch { res.status(503).json({ status: "error", database: "unavailable" }); }
});

app.get("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid product id" });
  const result = await query("SELECT id,name,category,price,stock,created_at FROM products WHERE id=$1", [id]);
  if (!result.rows.length) return res.status(404).json({ error: "Product not found" });
  res.json(result.rows[0]);
});

app.get("/api/analytics/overview", async (_req, res) => {
  try {
    const rows = await ch<{orders:string;revenue:string;customers:string;products:string}>(`
      SELECT uniqExact(order_id) orders, round(sum(total_amount),2) revenue,
             uniqExact(user_id) customers, uniqExact(product_id) products FROM fact_orders
    `);
    res.json(rows[0] ?? {orders:"0",revenue:"0",customers:"0",products:"0"});
  } catch (e) { console.error(e); res.status(503).json({error:"ClickHouse analytics unavailable"}); }
});

app.get("/api/analytics/revenue-by-category", async (_req, res) => {
  try { res.json(await ch<{category:string;revenue:string}>(`
    SELECT category, round(sum(total_amount),2) revenue FROM fact_orders
    GROUP BY category ORDER BY revenue DESC LIMIT 10
  `)); } catch (e) { console.error(e); res.status(503).json({error:"ClickHouse analytics unavailable"}); }
});

app.get("/api/analytics/daily-sales", async (_req, res) => {
  try { res.json(await ch<{day:string;revenue:string}>(`
    SELECT toDate(order_created_at) day, round(sum(total_amount),2) revenue
    FROM fact_orders GROUP BY day ORDER BY day
  `)); } catch (e) { console.error(e); res.status(503).json({error:"ClickHouse analytics unavailable"}); }
});

app.get("/api/analytics/top-products", async (_req, res) => {
  try { res.json(await ch<{product_id:string;revenue:string;quantity:string}>(`
    SELECT product_id, round(sum(total_amount),2) revenue, sum(quantity) quantity
    FROM fact_orders GROUP BY product_id ORDER BY revenue DESC LIMIT 10
  `)); } catch (e) { console.error(e); res.status(503).json({error:"ClickHouse analytics unavailable"}); }
});

app.listen(port, () => console.log(`HTAP backend listening on http://localhost:${port}`));
