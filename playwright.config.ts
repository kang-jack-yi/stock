import { defineConfig } from "@playwright/test";

/** 显式指定现有调试服务时只连接该服务；默认启动独立生产测试实例。 */
const existingServer = process.env.E2E_BASE_URL;

/** 浏览器测试通过真实 Next.js 服务运行，账号使用独立测试数据库。 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: existingServer || "http://127.0.0.1:3002",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "list",
  webServer: existingServer
    ? undefined
    : {
        command: "npm run start -- --port 3002",
        url: "http://127.0.0.1:3002",
        reuseExistingServer: false,
        timeout: 60000,
        env: { DATABASE_PATH: "./data/e2e.db" },
      },
});
