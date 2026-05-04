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
    let cancelled = false;
    fetch("/api/public/music", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((data: { tracks?: Track[] }) => {
        if (cancelled) return;
        setTracks(Array.isArray(data.tracks) ? data.tracks : []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setPlaying(false);
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

  if (collapsed) {
    return (
      <div className="music-player" role="region" aria-label="背景音乐">
        <button onClick={() => setCollapsed(false)} aria-label="展开播放器" title="展开">
          ♫
        </button>
      </div>
    );
  }

  return (
    <div className="music-player" role="region" aria-label="背景音乐">
      <audio
        ref={audioRef}
        src={currentTrack.filePath}
        loop={tracks.length === 1}
        onEnded={nextTrack}
      />
      <button onClick={togglePlay} aria-label={playing ? "暂停" : "播放"} title={playing ? "暂停" : "播放"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={nextTrack} aria-label="下一首" title="下一首">
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
        style={{ width: 64 }}
        onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
      />
      <button onClick={() => setCollapsed(true)} aria-label="折叠" title="折叠">
        –
      </button>
      <button onClick={close} aria-label="关闭" title="关闭播放器">
        ✕
      </button>
    </div>
  );
}
