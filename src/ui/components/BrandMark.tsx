import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { theme } from '../theme.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_BANNER = path.resolve(__dirname, '../../../assets/blonde-banner.png');

function resolveBannerPath(): string | null {
  const envPath = process.env.BLONDE_BANNER;
  if (envPath) {
    const resolved = envPath.replace(/^~/, os.homedir());
    if (fs.existsSync(resolved)) return resolved;
  }
  if (fs.existsSync(BUNDLED_BANNER)) return BUNDLED_BANNER;
  return null;
}

interface BrandMarkProps {
  width?: number;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ width = 20 }) => {
  const [ansi, setAnsi]       = useState<string | null>(null);
  const [ready, setReady]     = useState(false);

  useEffect(() => {
    const bannerPath = resolveBannerPath();
    if (!bannerPath) {
      setReady(true);
      return;
    }
    import('terminal-image')
      .then(({ default: terminalImage }) => terminalImage.file(bannerPath, { width }))
      .then(result => { setAnsi(result); setReady(true); })
      .catch(() => setReady(true));
  }, [width]);

  if (!ready) {
    return (
      <Box width={width} justifyContent="center">
        <Text color={theme.brand}>◆</Text>
      </Box>
    );
  }

  if (ansi) {
    return (
      <Box flexDirection="column" width={width} overflow="hidden">
        <Text>{ansi}</Text>
      </Box>
    );
  }

  // Text wordmark fallback — shown when no image file is found
  return (
    <Box flexDirection="column" width={width} paddingTop={1}>
      <Text bold color={theme.brand}>◆ Blonde</Text>
      <Text color={theme.text.dim}>v0.1.0</Text>
      <Text color={theme.text.dim}>AI Coding Agent</Text>
    </Box>
  );
};
