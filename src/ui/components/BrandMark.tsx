import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { theme } from '../theme.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../../../assets');

export const LOGO_OPTIONS = [
  { index: 1, label: 'starburst',  file: 'cerekin-logo-1.png' },
  { index: 2, label: 'eyes',       file: 'cerekin-logo-2.png' },
  { index: 3, label: 'brain',      file: 'cerekin-logo-3.png' },
];

function resolvePath(logoIndex?: number, bannerOverride?: string): string | null {
  if (bannerOverride) {
    const resolved = bannerOverride.replace(/^~/, os.homedir());
    if (fs.existsSync(resolved)) return resolved;
  }
  if (logoIndex !== undefined) {
    const opt = LOGO_OPTIONS.find(o => o.index === logoIndex);
    if (opt) {
      const p = path.join(ASSETS_DIR, opt.file);
      if (fs.existsSync(p)) return p;
    }
  }
  const envPath = process.env.BLONDE_BANNER;
  if (envPath) {
    const resolved = envPath.replace(/^~/, os.homedir());
    if (fs.existsSync(resolved)) return resolved;
  }
  const def = path.join(ASSETS_DIR, 'blonde-banner.png');
  if (fs.existsSync(def)) return def;
  return null;
}

// Upscale with sharp then render via terminal-image for each frame.
// Returns all ANSI frame strings + per-frame delay in ms.
async function loadFrames(
  filePath: string,
  width: number,
  height: number,
): Promise<{ frames: string[]; delays: number[] }> {
  const [{ default: sharp }, { default: ti }] = await Promise.all([
    import('sharp'),
    import('terminal-image'),
  ]);

  const isGif = filePath.toLowerCase().endsWith('.gif');

  // Read total frame count
  const meta = await sharp(filePath, { animated: false }).metadata();
  const frameCount = isGif ? (meta.pages ?? 1) : 1;

  // GIF stores delay in hundredths-of-a-second; sharp surfaces it in ms already
  const rawDelays: number[] = Array.isArray((meta as any).delay)
    ? (meta as any).delay
    : [];

  const frames: string[] = [];
  const delays: number[] = [];

  for (let i = 0; i < frameCount; i++) {
    // Upscale 8× before handing to terminal-image — gives it more detail to downsample
    const buf = await sharp(filePath, { animated: false, page: i })
      .resize(width * 8, height * 8, { kernel: 'lanczos3', fit: 'fill' })
      .png()
      .toBuffer();

    const ansi = await ti.buffer(buf, { width, height, preserveAspectRatio: false });
    frames.push(ansi);
    delays.push(rawDelays[i] ?? 80);
  }

  return { frames, delays };
}

interface BrandMarkProps {
  width?:          number;
  logoIndex?:      number;
  bannerOverride?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ width = 32, logoIndex, bannerOverride }) => {
  const [frames,   setFrames]   = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [ready,    setReady]    = useState(false);
  const delaysRef = useRef<number[]>([]);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Terminal chars are ~2:1 tall:wide → halve rows to get a square block
  const height = Math.round(width / 2);

  useEffect(() => {
    setFrames([]);
    setFrameIdx(0);
    setReady(false);
    if (timerRef.current) clearTimeout(timerRef.current);

    const bannerPath = resolvePath(logoIndex, bannerOverride);
    if (!bannerPath) { setReady(true); return; }

    loadFrames(bannerPath, width, height)
      .then(({ frames: f, delays: d }) => {
        delaysRef.current = d;
        setFrames(f);
        setReady(true);
      })
      .catch(() => setReady(true));

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [logoIndex, bannerOverride, width, height]);

  // Animate GIFs — schedule next frame after the per-frame delay
  useEffect(() => {
    if (frames.length <= 1) return;

    const schedule = (idx: number) => {
      const delay = delaysRef.current[idx] ?? 80;
      timerRef.current = setTimeout(() => {
        const next = (idx + 1) % frames.length;
        setFrameIdx(next);
        schedule(next);
      }, delay);
    };

    schedule(frameIdx);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [frames]);   // only re-attach when frames array changes

  if (!ready) {
    return (
      <Box width={width} height={height} justifyContent="center" alignItems="center">
        <Text color={theme.brand}>◆</Text>
      </Box>
    );
  }

  if (frames.length > 0) {
    return (
      <Box flexDirection="column" width={width} height={height} overflow="hidden">
        <Text>{frames[frameIdx]}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} paddingTop={1}>
      <Text bold color={theme.brand}>◆ Blonde</Text>
      <Text color={theme.text.dim}>v0.1.0</Text>
      <Text color={theme.text.dim}>AI Coding Agent</Text>
    </Box>
  );
};
