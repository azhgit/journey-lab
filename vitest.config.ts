import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // graphql@17 ships a separate `development` build. Vite picks it for our source while Node loads the
    // regular build for graphql-yoga, giving two GraphQLError classes and failing yoga's instanceof check
    // (every resolver error gets masked as "Unexpected error."). Pin both to the build Node uses.
    alias: [{ find: /^graphql$/, replacement: fileURLToPath(new URL("./node_modules/graphql/index.mjs", import.meta.url)) }],
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "viewer/src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
