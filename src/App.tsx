import { useState } from "react";
import { Extract, Create } from "./tabs";
import "./App.css";

type Mode = "extract" | "create";

function App() {
  const [mode, setMode] = useState<Mode>("extract");

  return (
    <div className="container">
      <div className="row tab">
        <span
          className={"item " + (mode === "extract" ? "" : "inactive")}
          onClick={() => setMode("extract")}
        >
          Extract
        </span>
        <span
          className={"item " + (mode === "create" ? "" : "inactive")}
          onClick={() => setMode("create")}
        >
          Create
        </span>
      </div>
      {mode === "extract" && <Extract />}
      {mode === "create" && <Create />}
    </div>
  );
}

export default App;
