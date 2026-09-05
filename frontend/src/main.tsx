import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppProviders } from "./app/providers";
import { applyThemePreference, readThemePreference, ThemeProvider } from "./components/theme-provider";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用挂载节点，无法启动 HuddleTab。");
}

applyThemePreference(readThemePreference());

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AppProviders>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppProviders>
    </ThemeProvider>
  </StrictMode>,
);
