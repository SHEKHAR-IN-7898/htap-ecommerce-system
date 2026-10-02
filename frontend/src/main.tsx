import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 960, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>HTAP E-Commerce System</h1>
      <p>Transactional and analytical workloads on a synchronized dataset.</p>
      <p>Phase 1 foundation is ready. Dashboard implementation comes after the data pipeline is validated.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
