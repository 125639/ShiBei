"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useUserPrefs } from "./useUserPrefs";

export function CustomCursor() {
  const { prefs, hydrated } = useUserPrefs();
  const [isHovering, setIsHovering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 25, stiffness: 400, mass: 0.5 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    if (!hydrated || !prefs.customCursor) return;

    const moveMouse = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      setIsVisible(true);
    };

    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName.toLowerCase() === "a" ||
        target.tagName.toLowerCase() === "button" ||
        target.tagName.toLowerCase() === "input" ||
        target.closest("a") ||
        target.closest("button") ||
        window.getComputedStyle(target).cursor === "pointer"
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    window.addEventListener("mousemove", moveMouse);
    window.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseenter", handleMouseEnter);

    // Make sure we apply the attribute globally here in case hydration was slow
    document.documentElement.setAttribute("data-cursor", "custom");
    document.documentElement.setAttribute("data-cursor-style", prefs.cursorStyle);

    return () => {
      window.removeEventListener("mousemove", moveMouse);
      window.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseenter", handleMouseEnter);
      document.documentElement.removeAttribute("data-cursor");
      document.documentElement.removeAttribute("data-cursor-style");
    };
  }, [hydrated, prefs.customCursor, prefs.cursorStyle, cursorX, cursorY]);

  if (!hydrated || !prefs.customCursor) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isVisible ? 1 : 0 }}
      transition={{ duration: 0.15 }}
      style={{ pointerEvents: "none", zIndex: 99999 }}
    >
      <motion.div
        className={`custom-cursor-dot cursor-${prefs.cursorStyle}`}
        style={{
          left: cursorX,
          top: cursorY,
        }}
      />
      <motion.div
        className={`custom-cursor-ring cursor-${prefs.cursorStyle} ${isHovering ? "hover" : ""}`}
        style={{
          left: cursorXSpring,
          top: cursorYSpring,
        }}
      />
    </motion.div>
  );
}
