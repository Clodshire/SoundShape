"use client";

import { useEffect, useRef } from "react";
import styles from "./site.module.css";

// Minimal slice of the YouTube IFrame Player API that this page uses.
interface YTPlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: { onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT as YTNamespace);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const PLAYING = 1;

interface Props {
  videoId: string;
  onTime: (t: number) => void;
  onPlaying: (playing: boolean) => void;
}

// Embeds the video and reports its clock, so captions follow the player the
// same way the Chrome extension follows video.currentTime on youtube.com.
export function YouTubeStage({ videoId, onTime, onPlaying }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    let player: YTPlayer | null = null;
    let poll = 0;
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !el) return;
      const mount = document.createElement("div");
      el.appendChild(mount);
      player = new YT.Player(mount, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, cc_load_policy: 0, iv_load_policy: 3 },
        events: {
          onStateChange: (e) => onPlaying(e.data === PLAYING),
        },
      });
      poll = window.setInterval(() => {
        const t = player?.getCurrentTime?.();
        if (typeof t === "number") onTime(t);
      }, 100);
    });
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      player?.destroy();
      if (el) el.innerHTML = "";
    };
  }, [videoId, onTime, onPlaying]);

  return <div ref={host} className={styles.ytHost} />;
}
