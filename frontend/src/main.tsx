import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppProviders } from "./app/providers";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用挂载节点，无法启动 HuddleTab。");
}

const savedTheme = localStorage.getItem("huddletab-theme");
if (savedTheme === "dark" || savedTheme === "light") {
  document.documentElement.classList.add(savedTheme);
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
