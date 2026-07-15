import { I18nText } from "@/components/I18nText";
import type { StatsBucket, TopicSlice } from "@/lib/stats";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)"
];

/* ================= Bar chart ================= */

export function BarChart({
  buckets,
  height = 180,
  color = "var(--chart-1)",
  showAllLabels = false,
  ariaLabel = "柱状图"
}: {
  buckets: StatsBucket[];
  height?: number;
  color?: string;
  showAllLabels?: boolean;
  ariaLabel?: string;
}) {
  if (!buckets.length) return <p className="muted"><I18nText zh="暂无数据" en="No data yet" /></p>;
  const padX = 24;
  const padY = 18;
  const width = 600;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const niceMax = niceCeil(max);
  const barW = innerW / buckets.length;
  const labelEvery = showAllLabels ? 1 : Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <svg className="chart-bar" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <desc>{buckets.map((bucket) => `${bucket.label}: ${bucket.count}`).join("；")}</desc>
      {axisTicks(niceMax).map((v, i) => {
        const y = padY + innerH * (1 - v / niceMax);
        return (
          <g key={i}>
            <line className="chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />
            <text x={padX - 6} y={y + 4} textAnchor="end" fontSize="11">
              {v}
            </text>
          </g>
        );
      })}
      {buckets.map((b, i) => {
        const h = (b.count / niceMax) * innerH;
        const x = padX + i * barW + 2;
        const y = padY + innerH - h;
        return (
          <g key={i}>
            <rect
              className="bar"
              x={x}
              y={y}
              width={Math.max(2, barW - 4)}
              height={h}
              fill={color}
              rx={2}
            >
              <title>{`${b.label}: ${b.count}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + (barW - 4) / 2} y={height - 4} textAnchor="middle" fontSize="11">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ================= Line chart ================= */

export function LineChart({
  buckets,
  height = 180,
  color = "var(--chart-2)",
  ariaLabel = "折线图"
}: {
  buckets: StatsBucket[];
  height?: number;
  color?: string;
  ariaLabel?: string;
}) {
  if (!buckets.length) return <p className="muted"><I18nText zh="暂无数据" en="No data yet" /></p>;
  const padX = 28;
  const padY = 18;
  const width = 600;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const niceMax = niceCeil(max);
  const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : innerW;

  const points = buckets.map((b, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH * (1 - b.count / niceMax);
    return { x, y, b };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${points[points.length - 1].x.toFixed(1)} ${(padY + innerH).toFixed(1)} L ${padX.toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <svg className="chart-line" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <desc>{buckets.map((bucket) => `${bucket.label}: ${bucket.count}`).join("；")}</desc>
      {axisTicks(niceMax).map((v, i) => {
        const y = padY + innerH * (1 - v / niceMax);
        return (
          <g key={i}>
            <line className="chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />
            <text x={padX - 6} y={y + 4} textAnchor="end" fontSize="11">
              {v}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill={color} opacity={0.18} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
          <title>{`${p.b.label}: ${p.b.count}`}</title>
        </circle>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={`l-${i}`} x={p.x} y={height - 4} textAnchor="middle" fontSize="11">
            {p.b.label}
          </text>
        ) : null
      )}
    </svg>
  );
}

/* ================= Donut chart ================= */

export function DonutChart({
  slices,
  ariaLabel = "环形图"
}: {
  slices: TopicSlice[];
  ariaLabel?: string;
}) {
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  if (!total) return <p className="muted"><I18nText zh="该时间段内无文章分类数据" en="No topic data in this window" /></p>;

  const size = 220;
  const radius = 90;
  const inner = 56;
  const cx = size / 2;
  const cy = size / 2;

  const arcs = slices.map((slice, i) => {
    const startCount = slices.slice(0, i).reduce((sum, item) => sum + item.count, 0);
    const endCount = startCount + slice.count;
    const startAngle = (startCount / total) * Math.PI * 2;
    const endAngle = (endCount / total) * Math.PI * 2;
    const path = donutPath(cx, cy, radius, inner, startAngle, endAngle);
    return { ...slice, path, color: CHART_COLORS[i % CHART_COLORS.length] };
  });

  return (
    <div>
      <svg className="chart-donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        <desc>
          {arcs.map((arc) => `${arc.name}: ${arc.count}（${((arc.count / total) * 100).toFixed(1)}%）`).join("；")}
        </desc>
        {arcs.map((a) => (
          <path key={a.id} d={a.path} fill={a.color}>
            <title>{`${a.name}: ${a.count}（${((a.count / total) * 100).toFixed(1)}%）`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="500">
          {total}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">
          <tspan className="i18n-zh" lang="zh-CN">总条目</tspan>
          <tspan className="i18n-en" lang="en">Total</tspan>
        </text>
      </svg>
      <div className="chart-legend">
        {arcs.map((a) => (
          <span key={a.id} title={`${a.name}: ${a.count}`}>
            <span className="dot" style={{ background: a.color }} />
            {a.name} · {a.count}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================= Stack/comparison bar (posts vs videos by day) ================= */

export function StackedBarChart({
  primary,
  secondary,
  height = 200,
  primaryColor = "var(--chart-1)",
  secondaryColor = "var(--chart-2)",
  primaryLabel,
  secondaryLabel,
  ariaLabel = "堆叠柱状图"
}: {
  primary: StatsBucket[];
  secondary: StatsBucket[];
  height?: number;
  primaryColor?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  ariaLabel?: string;
}) {
  if (!primary.length) return <p className="muted"><I18nText zh="暂无数据" en="No data yet" /></p>;
  // 未显式传标签时，desc/title 等纯字符串场景用中文缺省，可见图例走双语 I18nText。
  const primaryText = primaryLabel ?? "文章";
  const secondaryText = secondaryLabel ?? "视频";
  const padX = 28;
  const padY = 22;
  const width = 600;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(
    1,
    ...primary.map((b, i) => (b.count || 0) + (secondary[i]?.count || 0))
  );
  const niceMax = niceCeil(max);
  const barW = innerW / primary.length;
  const labelEvery = Math.max(1, Math.ceil(primary.length / 8));

  return (
    <div>
      <svg className="chart-bar" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <desc>
          {primary.map((bucket, index) => `${bucket.label} · ${primaryText}: ${bucket.count}，${secondaryText}: ${secondary[index]?.count || 0}`).join("；")}
        </desc>
        {axisTicks(niceMax).map((v, i) => {
          const y = padY + innerH * (1 - v / niceMax);
          return (
            <g key={i}>
              <line className="chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />
              <text x={padX - 6} y={y + 4} textAnchor="end" fontSize="11">
                {v}
              </text>
            </g>
          );
        })}
        {primary.map((b, i) => {
          const v = secondary[i]?.count || 0;
          const hP = (b.count / niceMax) * innerH;
          const hV = (v / niceMax) * innerH;
          const x = padX + i * barW + 2;
          const yP = padY + innerH - hP;
          const yV = yP - hV;
          return (
            <g key={i}>
              <rect
                x={x}
                y={yP}
                width={Math.max(2, barW - 4)}
                height={hP}
                fill={primaryColor}
                rx={2}
              >
                <title>{`${b.label} · ${primaryText}: ${b.count}`}</title>
              </rect>
              <rect
                x={x}
                y={yV}
                width={Math.max(2, barW - 4)}
                height={hV}
                fill={secondaryColor}
                rx={2}
              >
                <title>{`${b.label} · ${secondaryText}: ${v}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x + (barW - 4) / 2} y={height - 4} textAnchor="middle" fontSize="11">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span>
          <span className="dot" style={{ background: primaryColor }} />
          {primaryLabel ?? <I18nText zh="文章" en="Posts" />}
        </span>
        <span>
          <span className="dot" style={{ background: secondaryColor }} />
          {secondaryLabel ?? <I18nText zh="视频" en="Videos" />}
        </span>
      </div>
    </div>
  );
}

/* ================= Helpers ================= */

// 坐标轴只标整数：计数类图表出现 0.25×niceMax 这类分数刻度时，
// Math.round 会产生重复（1,1,1,0,0）或跳号（5,4,3,1,0）的轴标。
function axisTicks(niceMax: number): number[] {
  const step = niceMax <= 5 ? 1 : Number.isInteger(niceMax / 4) ? niceMax / 4 : niceMax / 5;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax; v += step) ticks.push(v);
  return ticks;
}

function niceCeil(v: number) {
  if (v <= 1) return 1;
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  if (v <= 20) return 20;
  if (v <= 50) return 50;
  if (v <= 100) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  if (n <= 2) return 2 * exp;
  if (n <= 5) return 5 * exp;
  return 10 * exp;
}

function donutPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
) {
  // Special-case full circle (single 100% slice) using two arcs.
  const span = endAngle - startAngle;
  if (Math.abs(span - Math.PI * 2) < 1e-6) {
    return [
      `M ${cx + outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy}`,
      `A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}`,
      `M ${cx + innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
      `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
      "Z"
    ].join(" ");
  }
  const largeArc = span > Math.PI ? 1 : 0;
  const x1 = cx + Math.cos(startAngle - Math.PI / 2) * outerR;
  const y1 = cy + Math.sin(startAngle - Math.PI / 2) * outerR;
  const x2 = cx + Math.cos(endAngle - Math.PI / 2) * outerR;
  const y2 = cy + Math.sin(endAngle - Math.PI / 2) * outerR;
  const x3 = cx + Math.cos(endAngle - Math.PI / 2) * innerR;
  const y3 = cy + Math.sin(endAngle - Math.PI / 2) * innerR;
  const x4 = cx + Math.cos(startAngle - Math.PI / 2) * innerR;
  const y4 = cy + Math.sin(startAngle - Math.PI / 2) * innerR;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    "Z"
  ].join(" ");
}
