import { RetryableSourceFetchError } from "./source-quality";

/**
 * page.evaluate 没有内置超时：页面主线程被死循环/挖矿脚本占住时它永不返回，
 * 而 goto / waitForLoadState 的超时此刻都已通过——这曾是唯一能把并发为 1 的
 * 抓取队列永久挂死的路径。超时后抛可重试错误；外层 finally 关闭 context，
 * 孤儿 evaluate 随之落定（这里预挂 catch 防 unhandledRejection）。
 */
export async function withEvaluateTimeout<T>(evaluation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RetryableSourceFetchError(`页面脚本执行超时（${Math.round(timeoutMs / 1000)}s），已放弃本次抓取`)),
      timeoutMs
    );
  });
  evaluation.catch(() => undefined);
  try {
    return await Promise.race([evaluation, watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
