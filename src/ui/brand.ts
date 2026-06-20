import { execSync } from 'child_process';

export const DEFAULT_BRAND_ART: readonly string[] = [
  '░▒▓███████▓▒░░▒▓█▓▒░      ░▒▓██████▓▒░░▒▓███████▓▒░░▒▓███████▓▒░░▒▓████████▓▒░',
  '░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░       ',
  '░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░       ',
  '░▒▓███████▓▒░░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓██████▓▒░  ',
  '░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░       ',
  '░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░       ',
  '░▒▓███████▓▒░░▒▓████████▓▒░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░',
];

export const NARROW_BRAND_ART: readonly string[] = [
  ' ____  _     ___  _   _ ____  _____',
  '| __ )| |   / _ \\| \\ | |  _ \\| ____|',
  '|  _ \\| |  | | | |  \\| | | | |  _|  ',
  '| |_) | |__| |_| | |\\  | |_| | |___ ',
  '|____/|_____\\___/|_| \\_|____/|_____|',
];

/** Pick the right art width for the current terminal. */
export function brandArtFor(cols: number, custom?: string[]): string[] {
  if (custom && custom.length > 0) return custom;
  const art = cols >= 100 ? DEFAULT_BRAND_ART : NARROW_BRAND_ART;
  return art as string[];
}

// ── Greeting helpers (shared by StartupScreen and WelcomeScreen) ──────────────

const GREETINGS_MORNING   = [
  'Good morning. Ready to ship something?',
  'Morning — what are we building today?',
  "Good morning. Coffee and code, let's go.",
];
const GREETINGS_AFTERNOON = [
  'Good afternoon. What needs fixing?',
  "Afternoon. Let's make some progress.",
  'Good afternoon — pick up where we left off?',
];
const GREETINGS_EVENING   = [
  'Good evening. Late-night session?',
  "Evening — what's on the agenda?",
  "Good evening. Let's get this done.",
];
const GREETINGS_GENERIC   = [
  'What shall we build today?',
  'Ready when you are.',
  'Your coding partner is here.',
  "Let's get to work.",
];

export function getUsername(): string {
  try {
    const name = execSync('git config user.name', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split(' ')[0];
    return name || process.env.USER || '';
  } catch {
    return process.env.USER || '';
  }
}

export function pickGreeting(name: string): string {
  const h    = new Date().getHours();
  const pool = h < 12 ? GREETINGS_MORNING
             : h < 18 ? GREETINGS_AFTERNOON
             : h < 23 ? GREETINGS_EVENING
             : GREETINGS_GENERIC;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return name ? `Hi ${name}. ${base}` : base;
}
