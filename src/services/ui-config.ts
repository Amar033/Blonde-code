import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.blonde', 'ui-config.json');

export interface UiConfig {
  banner?:    string;
  logoIndex?: number;
  /** Custom ASCII art lines shown on the startup screen (replaces default BLONDE art) */
  brandArt?:  string[];
  /** Static greeting override — skips AI greeting generation */
  greeting?:  string;
  /** Show the animated flower background on startup and welcome screens (default: true) */
  flowerBg?:  boolean;
}

export async function loadUiConfig(): Promise<UiConfig> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveUiConfig(patch: Partial<UiConfig>): Promise<void> {
  const existing = await loadUiConfig();
  await fs.mkdir(join(homedir(), '.blonde'), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify({ ...existing, ...patch }, null, 2));
}
