import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "src-tauri/target/**",
      "out/**",
      ".next/**",
      "playwright/.cache/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
