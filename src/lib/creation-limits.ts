// 私有写作台允许长文持续保存/导出；进入社区评分的作品必须保证评分模型
// 实际看过完整正文。当前评分协议的单次安全输入上限为 30,000 字符，因此
// 公开链路统一使用同一硬边界，绝不能只评分前段却给整篇正文签发 scoredHash。
export const MAX_SCORABLE_WORK_CONTENT_LENGTH = 30_000;

export const MAX_WRITING_DOC_CONTENT_LENGTH = 200_000;
