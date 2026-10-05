# 域名 / 后台 HTTPS 重定向回归记录

日期：2026-10-05。实例：`https://test.example.com`。

> 公开说明：服务器绝对路径已脱敏；`${DEPLOY_ROOT}` 代表服务用户的部署目录，`${BACKUP_ROOT}` 代表 root 备份目录。

## 修复范围

用户报告的是前台 HTTPS 正常，但进入后台或操作后跳回 `http://IP:端口`。
此前还在调整反代头时出现 HTTP/3 下 `$http_host` 为空、跳到内部 upstream 名称的问题。
两者不是同一个故障，不能把后一个问题当成原始问题的已证实根因。

- 服务器实际模式由 `full` 调整为 `backend`，PUBLIC_URL 保持 HTTPS 域名。
- Nginx 同时覆盖 Host / X-Forwarded-Host，保留显式端口并在 `$http_host` 为空时回退 `$host`。
- 单层入口覆盖外部自带的 X-Forwarded-For，应用仅监听 `127.0.0.1:8884`。
- `redirectTo()` 不再从 PUBLIC_URL 或上游请求地址拼站内导航，统一返回根相对 Location。
  这同时覆盖没有 Request 参数的后台操作。拒绝外部 URL、协议相对 URL、反斜线和控制字符。
- Next Proxy 使用同一请求源的绝对 URL 作为适配器输入，由框架转成相对 Location。
  直接给该适配器相对 Location 会在生产构建中报 Invalid URL，已通过隔离预览发现并修正，未部署故障构建。
- Cookie 安全策略与 CSRF 校验保持不变。配置 PUBLIC_URL 仍是 HTTPS 部署的必要步骤。

## 验证结果

1. 最终生产实例：`verify-domain-access.mjs` **75 项通过**。
   - 实际协商 HTTP/1.1、HTTP/2、HTTP/3；通过 CDP 验证登录 POST 使用对应协议。
   - HTTP/3 真实登录一次，其他协议使用错误登录验证 POST 跳转，再复用内存会话验证后台。
   - 后台首页、文章、任务、设置、来源、统计、同步；客户端导航、刷新、390px 移动视口。
   - 无效会话回到 HTTPS 域名登录页；未登录 API 返回 401。
   - 未登录及携带真实 Cookie 的跨域/null/sibling-origin 退出请求被拒绝，管理员会话仍有效。
   - HTTP 升级 HTTPS 保留路径和查询串；伪造转发头不能改变站内导航目的地。
2. 独立生产构建预览：故意设置 `PUBLIC_URL=http://203.0.113.10:8884`、`TRUST_PROXY_HOPS=0`。
   `/`、`/zh/posts`、无会话退出、错误登录全部返回相对 Location；共 4 项通过。
3. 相关自动测试：38 项 URL/模式/CSRF/Cookie/权限测试 + 7 项代理头/可信 IP 测试通过。
   URL 测试组合覆盖旧 HTTP IP、旧域名、缺失配置、0/1/2 代理跳数、缺失/异常转发头、非标准端口；
   框架集成测试实际调用 Next adapter，覆盖 backend/full/frontend。
4. 从开发机外部浏览器验证：HTTP 首页 → HTTPS 首页 → `/admin` → HTTPS 域名登录页。
5. 运行中 Nginx 与两个仓库配置样例均通过 `nginx -t`（样例只校验，未替换运行配置）。
6. TypeScript、变更文件 ESLint、git diff whitespace 检查通过。

## 明确未执行

- 未执行已登录账号退出，因为当前实现会吊销该管理员所有设备的会话。
  已验证无会话退出的跳转、跨域退出拦截，并覆盖退出所调用的统一跳转函数。
- 未修改文章、模型、来源设置，未执行发布/删除、同步导入或抓取。
  这些操作的导航由统一 redirectTo 回归覆盖，不等于业务写操作端到端验收。
- 不声称已穷尽所有 CDN、多层代理、浏览器或第三方面板组合；更换入口后应重新跑实机脚本。

## 部署与回退

部署保留服务器既有工作目录修改，仅更新两个跳转源文件与新构建；保留旧静态资源以减少已打开页面的资源失效。
健康接口构建标记：`1efd817-compact20260908-domain-https20261005`。

服务器备份目录：`${DEPLOY_ROOT}/shibei-domain-rollback-20261005`，包含旧 `.next`、两个源文件、环境及 Nginx 配置。
初始配置备份：`${BACKUP_ROOT}/shibei-domain-backup-20261005-040606`。
不要在应用运行时直接覆盖 `.next`；回退需停止应用、恢复成套源文件/构建/环境，再启动并验证健康及域名登录。

复测：在部署主机，以服务用户运行 `node scripts/e2e/verify-domain-access.mjs`。
脚本只向配置中的 PUBLIC_URL 发送凭据；不会记录密码或 Cookie。
