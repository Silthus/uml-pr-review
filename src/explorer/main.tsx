import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Explorer() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Architecture</h1>
      <a href="/pulls" className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
        Pull requests
      </a>
    </header>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Explorer />
  </StrictMode>,
);
