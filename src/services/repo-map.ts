import { readFileSync, statSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import os from 'os';

const CACHE_DIR  = join(os.homedir(), '.blonde');
const CACHE_FILE = join(CACHE_DIR, 'repo-map.json');
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  '__pycache__', '.cache', 'coverage', '.nyc_output', '.turbo',
]);
const SKIP_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.mp3', '.wav', '.zip', '.tar', '.gz',
  '.lock', '.bin', '.exe',
]);
const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

export interface FileSymbol {
  name:    string;
  kind:    string;       // fn | class | method | iface | type | const
  line:    number;
  parent?: string;
}

export interface MappedFile {
  path:    string;       // relative to root
  symbols: FileSymbol[];
  mtime:   number;
}

export interface RepoMap {
  root:    string;
  files:   MappedFile[];
  builtAt: number;
}

// ── File walker ──────────────────────────────────────────────────────────────

function walkDir(dir: string, root: string, out: string[]): void {
  let entries: import('fs').Dirent<string>[];
  try { entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' }); }
  catch { return; }

  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, root, out);
    } else if (e.isFile() && !SKIP_EXTS.has(extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
}

// ── TypeScript / JS parser ───────────────────────────────────────────────────

async function extractTsSymbols(content: string, filename: string): Promise<FileSymbol[]> {
  // Dynamic import — typescript is a devDep, keep it lazy
  const ts = (await import('typescript')).default;
  const symbols: FileSymbol[] = [];

  let src: import('typescript').SourceFile;
  try {
    src = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  } catch {
    return symbols;
  }

  const getLine = (node: import('typescript').Node) =>
    src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  function visit(node: import('typescript').Node, parent?: string): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'fn', line: getLine(node), parent });

    } else if (ts.isClassDeclaration(node) && node.name) {
      const cls = node.name.text;
      symbols.push({ name: cls, kind: 'class', line: getLine(node), parent });
      node.members.forEach(m => visit(m, cls));
      return;

    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      symbols.push({ name: node.name.text, kind: 'method', line: getLine(node), parent });

    } else if (ts.isInterfaceDeclaration(node)) {
      symbols.push({ name: node.name.text, kind: 'iface', line: getLine(node), parent });

    } else if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({ name: node.name.text, kind: 'type', line: getLine(node), parent });

    } else if (ts.isVariableStatement(node)) {
      const mods = ts.canHaveModifiers(node) ? (ts.getModifiers(node as import('typescript').HasModifiers) ?? []) : [];
      const exported = mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) {
        node.declarationList.declarations.forEach(d => {
          if (ts.isIdentifier(d.name)) {
            const kind = d.initializer && ts.isArrowFunction(d.initializer) ? 'fn' : 'const';
            symbols.push({ name: d.name.text, kind, line: getLine(node), parent });
          }
        });
      }
    }

    ts.forEachChild(node, child => visit(child, parent));
  }

  ts.forEachChild(src, node => visit(node));
  return symbols;
}

// ── Regex fallback for Python / Go / Rust ────────────────────────────────────

const LANG_PATTERNS: Record<string, Array<{ re: RegExp; kind: string }>> = {
  '.py': [
    { re: /^(?:async\s+)?def\s+(\w+)\s*\(/m,  kind: 'fn'    },
    { re: /^class\s+(\w+)/m,                   kind: 'class' },
  ],
  '.go': [
    { re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/m, kind: 'fn'     },
    { re: /^type\s+(\w+)\s+struct/m,                       kind: 'struct' },
  ],
  '.rs': [
    { re: /^(?:pub\s+)?fn\s+(\w+)\s*[(<]/m,   kind: 'fn'    },
    { re: /^(?:pub\s+)?struct\s+(\w+)/m,       kind: 'struct'},
    { re: /^(?:pub\s+)?enum\s+(\w+)/m,         kind: 'enum'  },
  ],
};

function extractRegexSymbols(content: string, ext: string): FileSymbol[] {
  const patterns = LANG_PATTERNS[ext];
  if (!patterns) return [];
  const symbols: FileSymbol[] = [];
  content.split('\n').forEach((line, i) => {
    for (const { re, kind } of patterns) {
      const m = line.match(re);
      if (m) symbols.push({ name: m[1], kind, line: i + 1 });
    }
  });
  return symbols;
}

// ── Map builder ──────────────────────────────────────────────────────────────

export async function buildRepoMap(root: string): Promise<RepoMap> {
  const paths: string[] = [];
  walkDir(root, root, paths);

  const files: MappedFile[] = [];

  for (const full of paths) {
    let mtime = 0;
    try { mtime = statSync(full).mtimeMs; } catch { continue; }

    let content: string;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    if (content.length > 200_000) continue;

    const ext     = extname(full).toLowerCase();
    const symbols = TS_EXTS.has(ext)
      ? await extractTsSymbols(content, full)
      : extractRegexSymbols(content, ext);

    files.push({ path: relative(root, full), symbols, mtime });
  }

  // Files with the most symbols first — they're the most navigable
  files.sort((a, b) => b.symbols.length - a.symbols.length);

  return { root, files, builtAt: Date.now() };
}

// ── Prompt formatter ─────────────────────────────────────────────────────────

export function formatRepoMap(map: RepoMap, maxChars = 5000): string {
  const out: string[] = [];
  let chars = 0;
  let skipped = 0;

  for (const file of map.files) {
    if (file.symbols.length === 0) {
      const line = `${file.path}\n`;
      if (chars + line.length > maxChars) { skipped++; continue; }
      out.push(line);
      chars += line.length;
      continue;
    }

    // Group: top-level symbols, methods nested under their class
    const topLevel = file.symbols.filter(s => !s.parent);
    const byParent  = new Map<string, FileSymbol[]>();
    file.symbols
      .filter(s => s.parent)
      .forEach(s => {
        if (!byParent.has(s.parent!)) byParent.set(s.parent!, []);
        byParent.get(s.parent!)!.push(s);
      });

    const symLines: string[] = [];
    for (const sym of topLevel) {
      if (sym.kind === 'class') {
        symLines.push(`  class ${sym.name}`);
        const methods = byParent.get(sym.name) ?? [];
        methods.slice(0, 6).forEach(m => symLines.push(`    ${m.name}()`));
        if (methods.length > 6) symLines.push(`    +${methods.length - 6} more`);
      } else {
        symLines.push(`  ${sym.kind} ${sym.name}`);
      }
    }

    const block = `${file.path}:\n${symLines.join('\n')}\n`;
    if (chars + block.length > maxChars) {
      // Include filename only — better than nothing
      const short = `${file.path}\n`;
      if (chars + short.length > maxChars) { skipped++; continue; }
      out.push(short);
      chars += short.length;
    } else {
      out.push(block);
      chars += block.length;
    }
  }

  if (skipped > 0) out.push(`(+${skipped} more files)\n`);
  return out.join('\n');
}

// ── Cache ────────────────────────────────────────────────────────────────────

function saveCache(map: RepoMap): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(map), 'utf8');
  } catch { /* non-fatal */ }
}

function loadCache(root: string): RepoMap | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const map = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as RepoMap;
    if (map.root !== root) return null;
    if (Date.now() - map.builtAt > CACHE_TTL) return null;
    return map;
  } catch {
    return null;
  }
}

// ── Singleton service ─────────────────────────────────────────────────────────

class RepoMapService {
  private map: RepoMap | null = null;
  private formatted: string   = '';
  private building             = false;

  async build(root: string): Promise<void> {
    if (this.building) return;

    const cached = loadCache(root);
    if (cached) {
      this.map       = cached;
      this.formatted = formatRepoMap(cached);
      return;
    }

    this.building = true;
    try {
      const map      = await buildRepoMap(root);
      this.map       = map;
      this.formatted = formatRepoMap(map);
      saveCache(map);
    } catch (e) {
      console.error('[RepoMap] Build failed:', e);
    } finally {
      this.building = false;
    }
  }

  getFormatted(): string {
    return this.formatted;
  }

  getMap(): RepoMap | null {
    return this.map;
  }

  // Called after write_file or edit_file so we re-index the affected path
  async invalidate(filePath: string, root: string): Promise<void> {
    if (!this.map) return;
    // Remove stale entry
    this.map.files = this.map.files.filter(f => f.path !== relative(root, filePath) && !filePath.endsWith(f.path));
    // Rebuild in background — don't block the agent
    this.build(root).catch(() => {});
  }

  search(query: string): Array<{ file: string; symbols: string[] }> {
    if (!this.map) return [];
    const q = query.toLowerCase();

    return this.map.files
      .map(file => {
        const fileMatch = file.path.toLowerCase().includes(q);
        const syms = file.symbols
          .filter(s => s.name.toLowerCase().includes(q) || s.parent?.toLowerCase().includes(q))
          .map(s => s.parent ? `${s.parent}.${s.name}` : `${s.kind} ${s.name}`);
        return fileMatch || syms.length > 0
          ? { file: file.path, symbols: syms }
          : null;
      })
      .filter(Boolean) as Array<{ file: string; symbols: string[] }>;
  }
}

export const repoMapService = new RepoMapService();
