// 크리티컬 경로 유닛 테스트 (2026-07-06) — 가입 검증·라우트 매핑 등 순수 로직 안전망.
//   실행: npm run test / CI: .github/workflows/preflight.yml unit job
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
