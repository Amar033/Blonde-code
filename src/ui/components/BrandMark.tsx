import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { theme } from '../theme.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../../../assets');

// Built-in logo options — cerekin-logo-1/2/3.png in assets/
export const LOGO_OPTIONS = [
  { index: 1, label: 'starburst',  file: 'cerekin-logo-1.png' },
  { index: 2, label: 'eyes',       file: 'cerekin-logo-2.png' },
  { index: 3, label: 'brain',      file: 'cerekin-logo-3.png' },
];

function resolvePath(logoIndex?: number): string | null {
  // Specific logo selected by the user at runtime
  if (logoIndex !== undefined) {
    const opt = LOGO_OPTIONS.find(o => o.index === logoIndex);
    if (opt) {
      const p = path.join(ASSETS_DIR, opt.file);
      if (fs.existsSync(p)) return p;
    }
  }
  // BLONDE_BANNER env override
  const envPath = process.env.BLONDE_BANNER;
  if (envPath) {
    const resolved = envPath.replace(/^~/, os.homedir());
    if (fs.existsSync(resolved)) return resolved;
  }
  // Bundled default
  const def = path.join(ASSETS_DIR, 'blonde-banner.png');
  if (fs.existsSync(def)) return def;
  return null;
}

interface BrandMarkProps {
  width?:     number;
  logoIndex?: number;   // 1 | 2 | 3 — selects a built-in cerekin logo
}

export const BrandMark: React.FC<BrandMarkProps> = ({ width = 20, logoIndex }) => {
  const [ansi,  setAnsi]  = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAnsi(null);
    setReady(false);

    const bannerPath = resolvePath(logoIndex);
    if (!bannerPath) { setReady(true); return; }

    import('terminal-image')
      .then(({ default: ti }) => ti.file(bannerPath, { width }))
      .then(result => { setAnsi(result); setReady(true); })
      .catch(() => setReady(true));
  }, [logoIndex, width]);

  if (!ready) {
    return <Box width={width} justifyContent="center"><Text color={theme.brand}>◆</Text></Box>;
  }

  if (ansi) {
    return (
      <Box flexDirection="column" width={width} overflow="hidden">
        <Text>{ansi}</Text>
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
