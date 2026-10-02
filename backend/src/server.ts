import "dotenv/config";
import express from "express";
import cors from "cors";
import { query } from "./db.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    const result = await query<{ now: string }>("SELECT NOW() AS now");
    res.json({ status: "ok", database: "postgresql", timestamp: result.rows[0]?.now });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid product id" });
  }

  const result = await query(
    "SELECT id, name, category, price, stock, created_at FROM products WHERE id = $1",
    [id],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Product not found" });
  }

  res.json(result.rows[0]);
});

app.listen(port, () => {
  console.log(`HTAP backend listening on http://localhost:${port}`);
});
