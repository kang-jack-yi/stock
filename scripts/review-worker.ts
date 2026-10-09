import { captureDailyReview, reviewWorkerHeartbeat } from "../src/lib/daily-review";
import { reviewCaptureWindow } from "../src/lib/review-compare";

let stopping = false;
/** 停止信号允许当前完整采集结束，避免中断已开启的数据库事务。 */
function stop() {
  stopping = true;
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

/** 独立进程每日收盘后采集一次，失败每三分钟重试并持续记录心跳。 */
async function run() {
  console.log("每日复盘采集进程已启动");
  let nextAttempt = 0;
  let completedDate = "";
  let retryMessage = "";
  while (!stopping) {
    const window = reviewCaptureWindow();
    if (!window.allowed) reviewWorkerHeartbeat(window.label);
    else if (completedDate === window.date)
      reviewWorkerHeartbeat(`当日 ${window.date} 收盘采集已完成；等待下一交易日`);
    else if (Date.now() >= nextAttempt) {
      try {
        reviewWorkerHeartbeat("正在获取完整市场与逐股日期验证，未完成前不保存历史");
        // 较慢的上游请求期间继续心跳，不能把正常采集误判为进程停止。
        const heartbeat = setInterval(
          () => reviewWorkerHeartbeat("正在核实完整市场收盘日期"),
          30000,
        );
        try {
          const result = await captureDailyReview();
          completedDate = result.date;
          reviewWorkerHeartbeat(result.message);
        } finally {
          clearInterval(heartbeat);
        }
      } catch (error) {
        nextAttempt = Date.now() + 180000;
        retryMessage = `采集失败，三分钟后重试：${error instanceof Error ? error.message : "行情服务不可用"}`;
        reviewWorkerHeartbeat(retryMessage);
      }
    } else reviewWorkerHeartbeat(retryMessage);
    for (let i = 0; i < 30 && !stopping; i++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
