export type ColorDepth = 'truecolor' | '256' | 'basic';
export type ThemeMode = 'dark' | 'light' | 'dark-ansi' | 'light-ansi';

export function detectColorDepth(): ColorDepth {
  if (process.env.TMUX && !process.env.FORCE_TRUECOLOR) return '256';
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return '256';
  const ct = process.env.COLORTERM;
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  if (['iTerm.app', 'WezTerm', 'Hyper', 'vscode'].includes(process.env.TERM_PROGRAM ?? '')) return 'truecolor';
  if (process.env.TERM?.includes('256color')) return '256';
  return 'basic';
}

export function detectDark(): boolean {
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const parts = fgbg.split(';');
    const bg = parseInt(parts[parts.length - 1] ?? '0', 10);
    return bg < 8;
  }
  return true;
}

const darkTokens = {
  bg: {
    base:      '#0d0d0d',
    surface:   '#111111',
    elevated:  '#1a1a1a',
    selection: '#1e3a5f',
  },
  border: {
    dim:    '#2a2a2a',
    normal: '#3a3a3a',
    active: '#4a9eff',
    subtle: '#222222',
  },
  text: {
    primary:   '#e8e8e8',
    secondary: '#aaaaaa',
    dim:       '#555555',
    link:      '#4a9eff',
  },
  status: {
    success: '#22c55e',
    error:   '#ef4444',
    warning: '#f59e0b',
    info:    '#4a9eff',
    running: '#a78bfa',
  },
  role: {
    user:      '#4a9eff',
    assistant: '#a78bfa',
    system:    '#555555',
  },
  diff: {
    added:    '#22c55e',
    modified: '#f59e0b',
    deleted:  '#ef4444',
  },
  syntax: {
    keyword:  '#f92672',
    string:   '#e6db74',
    comment:  '#75715e',
    number:   '#ae81ff',
    function: '#a6e22e',
    type:     '#66d9ef',
  },
  brand: '#a78bfa',
};

export type Theme = typeof darkTokens;

export const theme: Theme = { ...darkTokens };

let _mode: ThemeMode = detectDark() ? 'dark' : 'light';

export function getThemeMode(): ThemeMode { return _mode; }

export function applyThemeMode(mode: ThemeMode): void {
  _mode = mode;
  // light theme overrides can be added here in future
}
