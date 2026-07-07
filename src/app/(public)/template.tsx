import { SearchParamsTransition } from "@/components/SearchParamsTransition";

// 路由过渡：template 在每次导航时重新挂载，让内容区重放一次
// 淡入+轻微上移动画（见 globals.css 的 .route-transition）。
// 外壳（导航/侧栏/页脚）在 layout 里保持不动，只有内容区过渡。
// 只改查询参数的导航（分类筛选/翻页）不重挂载 template，
// 由 SearchParamsTransition 监听并重播同一动画，保证体验一致。
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="route-transition">
      <SearchParamsTransition />
      {children}
    </div>
  );
}
