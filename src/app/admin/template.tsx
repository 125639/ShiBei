// Next.js template：与 layout 不同，template 在每次客户端导航时为其子树创建
// 新实例（重新挂载），这正好重新触发 .admin-main 的 CSS 进入动画（见 globals.css
// 的 @keyframes admin-page-slide）——等价于 vue-element-admin 里用 <transition>
// 包 <router-view> 的路由过场。侧栏在各页 AdminShell 中结构一致，重挂载不产生
// 可见跳变；只有主内容区带动画。
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
