// NUL 字节在源码里既难读又易被工具截断，这里在运行期构造，绝不写进源文件。
const NUL = String.fromCharCode(0);

/**
 * Postgres 的 text/varchar 列不接受 NUL 字节(0x00)：外部抓取/RSS 正文里偶尔混入
 * 一个 0x00，整条 rawItem 落库就会以错误码 22021（invalid byte sequence for
 * encoding "UTF8": 0x00）失败，连带整个抓取任务失败。0x00 在正文里永远没有意义，
 * 落库前统一剥掉即可——换行、制表符等合法空白一概保留。
 *
 * 递归清洗对象/数组里的字符串；Date 等非「纯对象」原样返回，避免被 Object.entries
 * 拆成空对象而损坏（Prisma data 里常见 publishedAt: Date）。
 */
export function stripNulBytes<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes(NUL) ? value.split(NUL).join("") : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripNulBytes(item)) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = stripNulBytes(val);
    }
    return out as unknown as T;
  }
  return value;
}
