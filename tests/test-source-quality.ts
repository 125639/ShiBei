import assert from "node:assert/strict";
import test from "node:test";
import {
  assessGeneratedArticle,
  assessSourceMaterial,
  filterUsableEvidenceItems
} from "../src/lib/source-quality";

test("rejects HTTP error responses before article generation", () => {
  const assessment = assessSourceMaterial({
    title: "403 Forbidden",
    httpStatus: 403,
    content: "403 Forbidden Zen/4.3"
  });

  assert.equal(assessment.ok, false);
  if (!assessment.ok) assert.match(assessment.reason, /403|访问受限/);
});

test("rejects soft error pages returned as page text", () => {
  const assessment = assessSourceMaterial({
    title: "403 Forbidden",
    content: "403 Forbidden Zen/4.3"
  });

  assert.equal(assessment.ok, false);
});

test("keeps real articles that merely mention an HTTP error", () => {
  const assessment = assessSourceMaterial({
    title: "网站运维团队解释 403 Forbidden 的排查方法",
    content: [
      "一家云服务团队发布技术复盘，解释用户访问 API 时遇到 403 Forbidden 的原因。",
      "文章给出了权限配置、签名校验、反向代理规则和日志定位方法，并列出后续修复计划。"
    ].join("")
  });

  assert.equal(assessment.ok, true);
});

test("filters invalid evidence items before synthesis", () => {
  const evidence = filterUsableEvidenceItems([
    {
      title: "403 Forbidden",
      url: "https://www.thepaper.cn/",
      summary: "403 Forbidden Zen/4.3"
    },
    {
      title: "OpenAI 发布新模型",
      url: "https://example.com/ai",
      summary: "公司介绍了新模型的推理能力、价格和 API 上线计划。"
    }
  ]);

  assert.deepEqual(evidence.map((item) => item.title), ["OpenAI 发布新模型"]);
});

test("rejects generated drafts that only explain an invalid source page", () => {
  const generated = [
    "# 澎湃新闻链接返回 403 Forbidden，原始内容暂无法核验",
    "",
    "给定来源链接指向澎湃新闻网站，但当前可见页面仅显示“403 Forbidden”和“Zen/4.3”。",
    "因此，基于现有材料无法形成关于具体新闻事件的事实报道。",
    "",
    "## 参考来源",
    "- [澎湃新闻页面](https://www.thepaper.cn/)"
  ].join("\n");

  const assessment = assessGeneratedArticle(generated);
  assert.equal(assessment.ok, false);
});
