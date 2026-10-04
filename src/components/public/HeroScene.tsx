"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { I18nText, useRouteLanguage } from "@/components/I18nTextClient";
import { Icon } from "./Icons";
import { MotionToggle } from "./SiteMotion";

const MODES = [
  {
    zh: "发现",
    en: "Discover",
    word: "发现",
    title: "好奇心，是一切的起点。",
    titleEn: "It all starts with curiosity.",
    note: "从纷杂信息里，打捞值得留下的片段。",
    noteEn: "Find the stories worth keeping in a sea of information."
  },
  {
    zh: "思考",
    en: "Reflect",
    word: "思考",
    title: "多一个视角，多一层理解。",
    titleEn: "A new perspective. A deeper understanding.",
    note: "连接事实与背景，让阅读不止于知道。",
    noteEn: "Connect facts with context. Go beyond the headline."
  },
  {
    zh: "表达",
    en: "Create",
    word: "表达",
    title: "让你的想法，也被看见。",
    titleEn: "Give your ideas a place to live.",
    note: "写下观察，与更多保持好奇的人相遇。",
    noteEn: "Share an observation with other curious minds."
  }
];

export function HeroScene() {
  const [mode, setMode] = useState(0);
  const scene = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const english = useRouteLanguage() === "en";
  const current = MODES[mode];
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function move(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.siteMotion === "paused"
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      scene.current?.style.setProperty("--scene-x", `${x * 12}px`);
      scene.current?.style.setProperty("--scene-y", `${y * 12}px`);
    });
  }
  function reset() {
    cancelAnimationFrame(frame.current);
    scene.current?.style.setProperty("--scene-x", "0px");
    scene.current?.style.setProperty("--scene-y", "0px");
  }

  return (
    <div className="hero-scene" data-mode={mode} ref={scene} onPointerMove={move} onPointerLeave={reset}>
      <div className="scene-topline">
        <span>
          <span className="scene-live-dot" /> THE SHIBEI JOURNAL
        </span>
        <Icon name="spark" width="17" height="17" />
      </div>
      <div className="scene-artwork" aria-hidden="true">
        <div className="scene-orbit scene-orbit-one" />
        <div className="scene-orbit scene-orbit-two" />
        <span className="scene-coordinate">IDEAS / IN MOTION</span>
        <span className="scene-star scene-star-one">✳</span>
        <span className="scene-star scene-star-two">+</span>
        <div className="scene-sculpture">
          {Array.from({ length: 13 }, (_, i) => (
            <span className="shell-blade" key={i} style={{ "--blade": i } as CSSProperties} />
          ))}
          <span className="shell-pearl" />
        </div>
        <span className="scene-stamp" key={mode}>
          {english ? current.en : current.word}
          <small>COLLECT SOMETHING GOOD</small>
        </span>
        <span className="scene-footnote">
          A LITTLE LESS NOISE.
          <br />A LITTLE MORE WONDER.
        </span>
      </div>
      <div className="scene-note" aria-live="polite" aria-atomic="true">
        <span className="scene-note-index">0{mode + 1} /</span>
        <div key={mode}>
          <strong>{english ? current.titleEn : current.title}</strong>
          <p>{english ? current.noteEn : current.note}</p>
        </div>
      </div>
      <div className="scene-bottomline">
        <div
          className="scene-modes"
          role="group"
          aria-label={english ? "Explore the journal" : "探索拾贝理念"}
        >
          {MODES.map((item, index) => (
            <button key={item.en} type="button" aria-pressed={mode === index} onClick={() => setMode(index)}>
              <I18nText zh={item.zh} en={item.en} />
            </button>
          ))}
        </div>
        <MotionToggle />
      </div>
    </div>
  );
}
