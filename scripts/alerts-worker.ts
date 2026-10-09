import { checkAlerts, workerHeartbeat } from "../src/lib/alerts";

let stopping = false;
/** 接收进程停止信号，不中断正在提交的提醒事务。 */
function stop() {
  stopping = true;
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
/** 单独进程每 30 秒检查，关闭网页后仍继续运行；与 Next 服务使用同一数据库。 */
async function run() {
  console.log("站内提醒检查进程已启动");
  while (!stopping) {
    try {
      const result = await checkAlerts();
      workerHeartbeat(result.message);
    } catch (error) {
      workerHeartbeat(`检查失败：${error instanceof Error ? error.message : "行情服务不可用"}`);
    }
    for (let i = 0; i < 30 && !stopping; i++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
