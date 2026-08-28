// NUL 字节在源码里既难读又易被工具截断，这里在运行期构造，绝不写进源文件。
const NUL = String.fromCharCode(0);

/**
 * Postgres 的 text/varchar 列不接受 NUL 字节(0x00)：外部抓取/RSS 正文里偶尔混入
 * 一个 0x00，整条 rawItem 落库就会以错误码 22021（invalid byte sequence for
 * encoding "UTF8": 0x00）失败，连带整个抓取任务失败。0x00 在正文里永远没有意义，
 * 落库前统一剥掉即可——换行、制表符等合法空白一概保留。
 *
 * 该函数经 Prisma client extension 挂在**每一条**模型查询的 args 上（见
 * src/lib/prisma.ts），因此必须做到"干净输入零分配"：只有真的碰到 NUL 才拷贝
 * 受影响的层级，其余一律原样返回（=== 恒等）。
 *
 * 递归清洗对象/数组里的字符串；Date/Buffer/Decimal 等非「纯对象」原样返回，
 * 避免被拆成空对象而损坏（Prisma data 里常见 publishedAt: Date）。
 */
export function stripNulBytes<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes(NUL) ? value.split(NUL).join("") : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const cleaned = stripNulBytes(value[i]);
      if (cleaned !== value[i]) {
        if (copy === null) copy = value.slice();
        copy[i] = cleaned;
      }
    }
    return (copy ?? value) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const record = value as Record<string, unknown>;
    let copy: Record<string, unknown> | null = null;
    for (const key of Object.keys(record)) {
      const cleaned = stripNulBytes(record[key]);
      if (cleaned !== record[key]) {
        if (copy === null) copy = { ...record };
        copy[key] = cleaned;
      }
    }
    return (copy ?? value) as unknown as T;
  }
  return value;
}
