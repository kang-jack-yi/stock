import { checkSignals, signalHeartbeat } from "../src/lib/signals";
import { signalWindow } from "../src/lib/signal-evaluation";
let stopping = false;
/** 停止信号等待当前请求退出并释放租约，不中断已开启事务。 */
function stop() {
  stopping = true;
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
/** 盘后轮询未采样规则，已检查日期由数据库去重；闲时仅更新真实心跳。 */
async function run() {
  console.log("技术信号检查进程已启动");
  let next = 0,
    message = "等待有效收盘窗口";
  while (!stopping) {
    const window = signalWindow();
    if (!window.allowed) signalHeartbeat(window.label);
    else if (Date.now() >= next) {
      const heartbeat = setInterval(() => signalHeartbeat("正在核实关注股票收盘日线"), 30000);
      try {
        const result = await checkSignals();
        message = result.message;
      } catch (error) {
        message = `检查失败，三分钟后重试：${error instanceof Error ? error.message : "上游暂不可用"}`;
      } finally {
        clearInterval(heartbeat);
      }
      next = Date.now() + 180000;
      signalHeartbeat(message);
    } else signalHeartbeat(message);
    for (let i = 0; i < 30 && !stopping; i++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
