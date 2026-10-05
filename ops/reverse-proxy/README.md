# 外置反向代理样例

拾贝默认只提供 HTTP 应用入口，不管理域名、TLS 证书或 80/443。本目录的配置是可复制的起点，三种 `APP_MODE` 都使用同一种代理方式。

## 准备应用

把 `blog.example.com` 替换为你的域名，并修改拾贝 `.env`：

```dotenv
PUBLIC_URL="https://blog.example.com"
APP_BIND_IP="127.0.0.1"
APP_PORT="3000"
TRUST_PROXY_HOPS="1"
```

然后重启对应形态的应用：

```bash
# full
docker compose up -d

# backend
docker compose -f docker-compose.backend.yml up -d

# frontend
docker compose -f docker-compose.frontend.yml up -d
```

`PUBLIC_URL` 在运行时读取，不需要为换域名重建镜像。从 HTTP 切换到 HTTPS 后，浏览器会切换到 `Secure` + `__Host-*` Cookie，需要在新域名重新登录。

## 选择一种代理

- [Nginx](./nginx.conf)：适合已经由 Certbot/acme.sh/面板管理证书的服务器。
- [Caddy](./Caddyfile)：配置最少，默认自动申请和续期公开域名证书。
- [Traefik](./traefik.yml) + [动态配置](./traefik-dynamic.yml)：适合已经使用 Traefik file provider 的环境。

Nginx 样例中的证书路径必须替换为已由你的证书工具生成的文件。Traefik 样例启动前应创建 ACME 存储文件并限制权限：

```bash
sudo install -d -m 700 /var/lib/traefik
sudo touch /var/lib/traefik/acme.json
sudo chmod 600 /var/lib/traefik/acme.json
```

样例均把请求转发到 `http://127.0.0.1:3000`，适用于代理运行在宿主机上的情况，也是更新边界最简单的方式：应用容器换代时宿主端口不变，代理无需重载。如果代理也在容器中，容器里的 `127.0.0.1` 是代理自己；应把代理和拾贝 `app` 连入同一个 Docker 网络，并将上游改为 `http://app:3000`，或使用已正确配置的 host gateway。容器版 Nginx 还需使用 Docker DNS 动态解析上游，或在应用容器换代后由你自己的代理编排负责 reload；拾贝更新器不会操作外部代理。

## 可信代理边界

样例都保留 `Host`，并转发 `X-Forwarded-Proto`、`X-Forwarded-For` 等标准头。`TRUST_PROXY_HOPS=1` 只适用于浏览器与拾贝之间为一层固定代理，且客户端不能绕过代理直连应用端口。

- 端口直连或没有反代：`TRUST_PROXY_HOPS=0`。
- 同机单层反代：`APP_BIND_IP=127.0.0.1` 且 `TRUST_PROXY_HOPS=1`。
- CDN + 入口代理：按真实固定层数配置，并用防火墙只允许 CDN 出口访问源站。

不要信任任意外部请求自带的 `X-Forwarded-*` 头。信任层数填大会让客户端伪造 IP，影响限流、审计与匿名额度。

## 从旧版内置 HTTPS 迁移

旧版 `proxy` 只为过渡更新保留，新安装不要启动它。存量实例按下面顺序切换，避免旧更新器继续尝试重启代理：

1. 先准备并校验本目录中的一种外置代理配置，但暂不要占用旧代理正在监听的 80/443。
2. 按本页开头修改 `.env`，重启 `app`，确认 `curl -fsS http://127.0.0.1:3000/api/health` 成功。
3. 从 `.env` 删除旧的 `UPDATE_RECREATE_SERVICES=proxy` 行，再重建一次新版更新器：

   ```bash
   docker compose up -d --build --force-recreate updater
   ```

4. 停用旧证书续期任务，停止旧 `proxy`，随即启动你自己的代理：

   ```bash
   sudo systemctl disable --now shibei-tls-renew.timer 2>/dev/null || true
   docker compose --profile https stop proxy
   # 然后启动或重载你自己的 Nginx / Caddy / Traefik
   ```

5. 验证域名 HTTPS、登录、上传和 `/api/health` 后，再删除旧代理容器及 `/etc/shibei-tls.conf`。证书目录是否删除由管理员自行决定，项目更新器不会处理它。

切换 80/443 时通常会有一次很短的入口切换窗口；先完成配置校验可把窗口压到只剩停止旧代理和启动新代理的时间。

## 上线检查

```bash
# 应用上游
curl -fsS http://127.0.0.1:3000/api/health

# HTTP 应跳转到 HTTPS
curl -I http://blog.example.com

# 公开 HTTPS 健康检查
curl -fsS https://blog.example.com/api/health
```

确认防火墙对公网只放行 80/443，3000 只在本机可达。更新拾贝时不需要修改这些代理配置；应用更新器也不会重载代理或处理证书。


## 域名登录回归（含 HTTP/3）

后端部署必须设置 `APP_MODE=backend`；`PUBLIC_URL` 只声明对外地址，不会自动改变应用模式。
使用 systemd/裸机部署时，在服务实际读取的 `.env` 中修改并重启应用；不要只改另一份工作目录的文件。

Nginx 不应直接把 `$http_host` 作为唯一的上游 Host：某些 HTTP/3 请求中它为空，
Nginx/应用会退回内部 upstream 名称，产生 `https://backend_xxx/admin` 一类无效跳转。
样例通过 `map` 优先保留 `$http_host`（含显式端口），为空时使用 `$host`，并用同一值覆盖
`Host` 和 `X-Forwarded-Host`。`map` 必须放在 `http` 上下文内，不能放进 `server`/`location`。
不要仅用 curl 或健康接口判断登录成功：浏览器可能在收到 Alt-Svc 后切换到 HTTP/3。
不要用关闭 CSRF 校验、关闭 Secure Cookie 或信任所有代理来绕过问题。

在部署主机上，以服务用户执行：

```bash
node scripts/e2e/verify-domain-access.mjs
```

测试要求该部署已安装 Playwright Chromium，并支持 HTTP/3（UDP 443 可达）。脚本会校验浏览器
**实际协商的协议**，分别覆盖 HTTP/1.1、HTTP/2、HTTP/3，不接受降级后“假通过”。
它仅向 `.env` 的 `PUBLIC_URL` 发送本机管理员凭据，真实登录一次，再在内存中复用会话；
不会输出密码/Cookie，不写文章、设置或触发任务。覆盖登录跳转、后台各页、客户端导航、
刷新、移动视口、未登录 API 拒绝、跨域修改拒绝及伪造转发头覆盖。
注意：已登录退出会吊销该管理员所有设备的会话，因此自动测试只验证无会话退出及跨域退出拦截。

修改面板反代配置后应重新运行本测试；面板重新生成配置可能覆盖人工修复。


### 防止「前台 HTTPS，后台跳回 HTTP IP:端口」

站内后台跳转与订阅/分享链接是两类用途：`PUBLIC_URL` 继续用于站点身份与 Cookie 策略，
但不能拿旧值拼接登录、退出或表单操作后的导航。`src/lib/redirect.ts` 统一输出根相对
`Location: /admin/...`，包括没有 Request 参数的调用；浏览器保留当前协议、域名及端口。
Next Proxy 对 Location 有绝对 URL 输入要求，因此在其适配器内使用当前请求同源 URL，
让框架在发出响应前转成相对路径；对应测试实际执行 Next adapter，不只是调用纯函数。
不要启用跳过 middleware URL normalization 的配置而不重新验证这些测试。

这不代表可以省略部署配置：HTTPS 实例仍必须正确设置 `PUBLIC_URL=https://域名`、
可信代理跳数和监听范围，否则 Cookie 安全策略、CSRF、订阅链接仍可能不正确。
自动测试包含旧 HTTP IP 配置、缺失/异常代理头、非标准端口、无 Request 的后台跳转，
以及 backend/full/frontend 三种模式的框架级重定向。
