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
