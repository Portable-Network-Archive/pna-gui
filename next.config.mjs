import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const e2eBridgeRelative =
  process.env.NEXT_PUBLIC_TAURI_E2E === "true"
    ? "./src/testing/e2e-wdio-bridge.ts"
    : "./src/testing/e2e-bridge.ts";
const e2eBridge = resolve(root, e2eBridgeRelative);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  turbopack: {
    resolveAlias: {
      "@pna/e2e-bridge": e2eBridgeRelative,
    },
  },
  webpack(config) {
    config.resolve.alias["@pna/e2e-bridge"] = e2eBridge;
    return config;
  },
};

export default nextConfig;
