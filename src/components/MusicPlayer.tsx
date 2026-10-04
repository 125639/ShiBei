"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUserPrefs } from "./useUserPrefs";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  filePath: string;
};

/**
 * Floating ambient music player for public visitors.
 *
 * - Reads music preferences from useUserPrefs (localStorage).
 * - Loads track list from /api/public/music.
 * - Player only renders when at least one track exists and the user has
 *   explicitly enabled music in their settings.
 * - Browsers block audio autoplay until user interaction; the play button
 *   handles that gracefully.
 */
export function MusicPlayer() {
  const { prefs, update, hydrated } = useUserPrefs();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // A full playback bar competes with reading controls on a phone. Start as
    // one expandable touch target; toggling it never remounts the audio element.
    const media = window.matchMedia("(max-width: 720px)");
    const collapse = () => { if (media.matches) setCollapsed(true); };
    const timer = window.setTimeout(collapse, 0);
    media.addEventListener("change", collapse);
    return () => { clearTimeout(timer); media.removeEventListener("change", collapse); };
  }, []);

  useEffect(() => {
    // 只有用户在 /settings 显式开启音乐后才拉取曲库：本组件挂在 PublicShell，
    // 出现在每个公开页面上，而绝大多数访客从不开启音乐——不该让他们
    // 在每个页面都白付一次 API 往返 + JSON 解析。
    if (!hydrated || !prefs.musicEnabled) return;
    // 8s 超时：曲库接口异常时不要让播放器一直处于「未加载」状态。
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch("/api/public/music", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((data: { tracks?: Track[] }) => {
        if (cancelled) return;
        setTracks(Array.isArray(data.tracks) ? data.tracks : []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [hydrated, prefs.musicEnabled]);

  const currentTrack = useMemo(() => {
    if (!tracks.length) return null;
    if (prefs.musicTrackId) {
      const found = tracks.find((t) => t.id === prefs.musicTrackId);
      if (found) return found;
    }
    return tracks[0];
  }, [tracks, prefs.musicTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = prefs.musicVolume;
  }, [prefs.musicVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!prefs.musicEnabled) {
      audio.pause();
      return;
    }
    // Autoplay attempt; will silently fail without user interaction (expected).
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [prefs.musicEnabled, currentTrack?.id]);

  if (!hydrated || !loaded || !prefs.musicEnabled || !currentTrack) {
    return null;
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function nextTrack() {
    if (!tracks.length) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack?.id);
    const next = tracks[(idx + 1) % tracks.length];
    update({ musicTrackId: next.id });
  }

  function close() {
    update({ musicEnabled: false });
  }

  // <audio> 常驻挂载：折叠只隐藏控制条，不打断播放。
  // ref 回调里同步音量：音量 effect 首次执行时组件还在返回 null（audioRef 为
  // 空、no-op），等 <audio> 真正挂载时该 effect 因依赖未变不会再跑——不在这里
  // 设置的话，播放器总是以浏览器默认的 100% 音量开播，而滑杆显示的是偏好值。
  return (
    <div className="music-player" data-collapsed={collapsed || undefined} role="region" aria-label="背景音乐">
      <audio
        ref={(el) => {
          audioRef.current = el;
          if (el) el.volume = prefs.musicVolume;
        }}
        src={currentTrack.filePath}
        loop={tracks.length === 1}
        onEnded={nextTrack}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} aria-label="展开播放器" aria-expanded="false" title="展开">
          ♫
        </button>
      ) : (
        <>
          <button type="button" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"} title={playing ? "暂停" : "播放"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" onClick={nextTrack} aria-label="下一首" title="下一首">
            ⏭
          </button>
          <span className="music-title" title={currentTrack.title}>
            {currentTrack.title}
            {currentTrack.artist ? ` · ${currentTrack.artist}` : ""}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.musicVolume}
            aria-label="音量"
            aria-valuetext={`${Math.round(prefs.musicVolume * 100)}%`}
            title={`音量 ${Math.round(prefs.musicVolume * 100)}%`}
            style={{ width: 64 }}
            onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
          />
          <button type="button" onClick={() => setCollapsed(true)} aria-label="折叠播放器" aria-expanded="true" title="折叠">
            –
          </button>
          <button type="button" onClick={close} aria-label="关闭" title="关闭播放器">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
