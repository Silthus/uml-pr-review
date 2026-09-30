import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts"],
  extends: [tseslint.configs.base],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/billing/internal/**"],
            message:
              "billing internals are private. Import from the billing facade at src/products/billing/index.ts instead.",
          },
        ],
      },
    ],
  },
});
