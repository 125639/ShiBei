import { PublicShell } from "@/components/PublicShell";

// 公开页共用外壳放在路由组 layout 里：导航/页脚在页面切换间保持挂载，
// loading.tsx 只替换内容区，且站点设置只需在 shell 层取一次。
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
