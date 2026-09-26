import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { ExplorerApp } from "./app.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExplorerApp />
  </StrictMode>,
);
