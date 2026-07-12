"use client";

import { useEffect, useRef, useState } from "react";
import { useUserPrefs } from "./useUserPrefs";
import type { CursorStyleKey } from "@/lib/themes";

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, label, summary, [role='button']";

/* ===================== 光标粒子特效（参考 tholman/cursor-effects） =====================
 *
 * 除「经典圆环」外的样式都是画在一块全屏 canvas 上的拖尾粒子：
 * 指针移动时按走过的距离投放粒子，rAF 逐帧更新；粒子耗尽且指针静止后停帧省电。
 * 这些样式不隐藏系统指针（与 cursor-effects 原库一致——特效跟着真实指针走）。
 *
 * 物理量以 16.7ms 为基准帧写死，再按真实 dt 缩放，保证高刷屏和掉帧时速度一致。
 */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  seed: number;
};

type Engine = {
  /** 指针移动时调用；dx/dy 为本次位移，用于按距离控制投放密度 */
  spawn(x: number, y: number, dx: number, dy: number): void;
  /** 更新并绘制一帧；返回是否还有存活粒子 */
  step(ctx: CanvasRenderingContext2D, dt: number): boolean;
};

/**
 * 按走过的距离每 step 像素投放一个粒子,并沿本次位移线段插值出生点,
 * 快速甩动鼠标时粒子均匀铺成一条轨迹而不是挤成一团。
 */
function makeSpacedSpawner(step: number, emit: (x: number, y: number) => void) {
  let carry = 0;
  return (x: number, y: number, dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    carry += dist;
    while (carry > step) {
      carry -= step;
      const back = dist > 0 ? Math.min(1, carry / dist) : 0;
      emit(x - dx * back, y - dy * back);
    }
  };
}

/** 仙尘：彩色小方片洒落，轻微上抛后受重力下坠、缩小消失（fairyDustCursor 的配色与手感） */
function makeFairyDust(): Engine {
  const colors = ["#d61c59", "#e7d84b", "#1b8798"];
  const parts: Particle[] = [];
  const spawner = makeSpacedSpawner(9, (x, y) => {
    parts.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -0.2 - Math.random() * 0.5,
      age: 0,
      ttl: 650 + Math.random() * 500,
      size: 2.2 + Math.random() * 2.4,
      color: colors[(Math.random() * colors.length) | 0],
      seed: 0
    });
    if (parts.length > 160) parts.splice(0, parts.length - 160);
  });
  return {
    spawn: spawner,
    step(ctx, dt) {
      const k = dt / 16.7;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.ttl) {
          parts.splice(i, 1);
          continue;
        }
        p.vy += 0.05 * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        const remain = 1 - p.age / p.ttl;
        const s = p.size * remain;
        ctx.globalAlpha = Math.min(1, remain * 1.6);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      return parts.length > 0;
    }
  };
}

/** 彩虹丝带：六色平行线沿指针轨迹铺开，停下后从尾端逐渐收干（rainbowCursor 的经典配色） */
function makeRainbow(): Engine {
  const colors = ["#fe0000", "#fd8c00", "#ffe500", "#119f0b", "#0644b3", "#c22edc"];
  const band = 2.4; // 单条色带粗细
  const trail: Array<{ x: number; y: number }> = [];
  let drain = 0;
  return {
    spawn(x, y, dx, dy) {
      // 原地微动只更新末端，不堆积轨迹点
      if (trail.length && Math.hypot(dx, dy) < 3) {
        trail[trail.length - 1].x = x;
        trail[trail.length - 1].y = y;
        return;
      }
      trail.push({ x, y });
      if (trail.length > 24) trail.shift();
    },
    step(ctx, dt) {
      drain += dt;
      if (drain > 26 && trail.length) {
        trail.shift();
        drain = 0;
      }
      if (trail.length < 2) return trail.length > 0;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // 每条色带沿轨迹的法线方向平移,任何移动方向都摊成六色缎带
      const mid = (colors.length - 1) / 2;
      for (let c = 0; c < colors.length; c++) {
        ctx.beginPath();
        ctx.strokeStyle = colors[c];
        ctx.lineWidth = band;
        for (let i = 0; i < trail.length; i++) {
          const prev = trail[Math.max(0, i - 1)];
          const next = trail[Math.min(trail.length - 1, i + 1)];
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const len = Math.hypot(tx, ty) || 1;
          // 法线 = 切线旋转 90°,单位化后乘以该色带的偏移量
          const nx = -ty / len;
          const ny = tx / len;
          const off = (c - mid) * band;
          const px = trail[i].x + nx * off;
          const py = trail[i].y + ny * off;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      return true;
    }
  };
}

/** 气泡：移动时冒出小气泡，左右摆动着上浮、微微长大后消散（bubbleCursor 的蓝白配色） */
function makeBubbles(): Engine {
  const parts: Particle[] = [];
  const spawner = makeSpacedSpawner(22, (x, y) => {
    parts.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.5 + Math.random() * 0.9),
      age: 0,
      ttl: 900 + Math.random() * 700,
      size: 1.6 + Math.random() * 2.6,
      color: "",
      seed: Math.random() * Math.PI * 2
    });
    if (parts.length > 90) parts.splice(0, parts.length - 90);
  });
  return {
    spawn: spawner,
    step(ctx, dt) {
      const k = dt / 16.7;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.ttl || p.y < -20) {
          parts.splice(i, 1);
          continue;
        }
        p.x += (p.vx + Math.sin(p.seed + p.age / 240) * 0.25) * k;
        p.y += p.vy * k;
        p.size += 0.012 * k;
        const t = p.age / p.ttl;
        ctx.globalAlpha = t < 0.75 ? 0.85 : 0.85 * (1 - (t - 0.75) / 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(230, 241, 247, 0.35)";
        ctx.strokeStyle = "#3cb9fc";
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        // 左上角一点高光，气泡才像玻璃珠而不是圆圈
        ctx.beginPath();
        ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, Math.max(0.5, p.size * 0.18), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return parts.length > 0;
    }
  };
}

/** 流萤：稀疏的暖色光点，低频摆动着缓缓游走，呼吸式淡入淡出（呼应站内流萤风格） */
function makeFireflies(): Engine {
  const colors = ["#ffd27d", "#ffb45a", "#ffe9b8"];
  const parts: Particle[] = [];
  const spawner = makeSpacedSpawner(26, (x, y) => {
    parts.push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 12,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5 - 0.12,
      age: 0,
      ttl: 1300 + Math.random() * 900,
      size: 1 + Math.random() * 1.4,
      color: colors[(Math.random() * colors.length) | 0],
      seed: Math.random() * Math.PI * 2
    });
    if (parts.length > 70) parts.splice(0, parts.length - 70);
  });
  return {
    spawn: spawner,
    step(ctx, dt) {
      const k = dt / 16.7;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.ttl) {
          parts.splice(i, 1);
          continue;
        }
        p.x += (p.vx + Math.sin(p.seed + p.age / 320) * 0.22) * k;
        p.y += (p.vy + Math.cos(p.seed * 1.7 + p.age / 380) * 0.18) * k;
        ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, p.age / p.ttl)) * 0.9;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return parts.length > 0;
    }
  };
}

function createEngine(style: CursorStyleKey): Engine {
  switch (style) {
    case "rainbow":
      return makeRainbow();
    case "bubbles":
      return makeBubbles();
    case "fireflies":
      return makeFireflies();
    default:
      return makeFairyDust();
  }
}

/**
 * 自定义光标。两种形态：
 * - classic：小点即时跟随 + 圆环 rAF 插值拖尾（隐藏系统指针）；
 * - 粒子样式（仙尘/彩虹/气泡/流萤）：全屏 canvas 拖尾特效，保留系统指针。
 * 仅在精确指针设备且未开启"减少动态效果"时激活，与 CSS 的媒体查询守卫一致。
 */
export function CustomCursor() {
  const { prefs, hydrated } = useUserPrefs();
  const [finePointer, setFinePointer] = useState(false);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const apply = () => setFinePointer(fine.matches && motionOk.matches);
    apply();
    fine.addEventListener("change", apply);
    motionOk.addEventListener("change", apply);
    return () => {
      fine.removeEventListener("change", apply);
      motionOk.removeEventListener("change", apply);
    };
  }, [hydrated]);

  const enabled = hydrated && prefs.customCursor && finePointer;
  const styleKey = prefs.cursorStyle;

  // CSS 依赖这两个属性决定是否隐藏系统指针（只有 classic 隐藏）
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.setAttribute("data-cursor", "custom");
    document.documentElement.setAttribute("data-cursor-style", styleKey);
    return () => {
      document.documentElement.removeAttribute("data-cursor");
      document.documentElement.removeAttribute("data-cursor-style");
    };
  }, [enabled, styleKey]);

  // ── classic：DOM 小点 + 圆环 ──
  useEffect(() => {
    if (!enabled || styleKey !== "classic") return;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    const target = { x: -100, y: -100 };
    const ringPos = { x: -100, y: -100 };
    let raf = 0;
    let running = false;
    let lastMove = 0;

    const render = () => {
      ringPos.x += (target.x - ringPos.x) * 0.24;
      ringPos.y += (target.y - ringPos.y) * 0.24;
      ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) translate(-50%, -50%)`;
      const settled = Math.abs(target.x - ringPos.x) < 0.1 && Math.abs(target.y - ringPos.y) < 0.1;
      if (settled && performance.now() - lastMove > 2000) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(render);
    };

    const wake = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      lastMove = performance.now();
      dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      dot.classList.add("visible");
      ring.classList.add("visible");
      wake();
    };

    const onOver = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      ring.classList.toggle("hover", Boolean(el?.closest(INTERACTIVE_SELECTOR)));
    };

    const onLeave = () => {
      dot.classList.remove("visible");
      ring.classList.remove("visible");
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled, styleKey]);

  // ── 粒子样式：全屏 canvas + 对应引擎 ──
  useEffect(() => {
    if (!enabled || styleKey === "classic") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const engine = createEngine(styleKey);
    let raf = 0;
    let running = false;
    let lastFrame = 0;
    let lastMove = 0;
    let px = NaN;
    let py = NaN;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const frame = (now: number) => {
      const dt = Math.min(48, lastFrame ? now - lastFrame : 16.7);
      lastFrame = now;
      ctx.clearRect(0, 0, width, height);
      const alive = engine.step(ctx, dt);
      if (!alive && now - lastMove > 400) {
        running = false;
        lastFrame = 0;
        ctx.clearRect(0, 0, width, height);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (!running) {
        running = true;
        lastFrame = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: MouseEvent) => {
      const dx = Number.isNaN(px) ? 0 : e.clientX - px;
      const dy = Number.isNaN(py) ? 0 : e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      lastMove = performance.now();
      engine.spawn(e.clientX, e.clientY, dx, dy);
      wake();
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", resize);
    };
  }, [enabled, styleKey]);

  if (!enabled) return null;

  if (styleKey !== "classic") {
    return <canvas ref={canvasRef} className="cursor-fx-canvas" aria-hidden="true" />;
  }

  // 初始移出视口，等第一次 mousemove 再定位显示，避免左上角闪现。
  const offscreen = { transform: "translate3d(-100px, -100px, 0) translate(-50%, -50%)" };
  return (
    <div aria-hidden="true">
      <div ref={dotRef} className="custom-cursor-dot cursor-classic" style={offscreen} />
      <div ref={ringRef} className="custom-cursor-ring cursor-classic" style={offscreen} />
    </div>
  );
}
