import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import * as Tooltip from "@radix-ui/react-tooltip";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Tooltip.Provider delayDuration={300}>
      <App />
    </Tooltip.Provider>
  </React.StrictMode>,
);
