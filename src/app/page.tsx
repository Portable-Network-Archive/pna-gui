"use client";

import App from "@/App";
import { TooltipProvider } from "@radix-ui/react-tooltip";

export default function Home() {
  return (
    <TooltipProvider>
      <App />
    </TooltipProvider>
  );
}
