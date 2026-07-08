// 构建版本信息：镜像构建时由 Dockerfile 的 ARG GIT_COMMIT / BUILD_TIME 注入
// （见 scripts/deploy.sh 与 docker-compose 的 build.args）。
// 本地 dev 或手工 next build 没有注入时显示 dev，一眼区分"线上跑的是哪个版本"，
// 避免再出现改了代码却在看旧镜像的排查弯路。
export function getBuildInfo() {
  return {
    commit: process.env.BUILD_COMMIT || "dev",
    builtAt: process.env.BUILD_TIME || null
  };
}
