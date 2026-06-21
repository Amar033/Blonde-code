// Maps a user query to the minimal set of tools needed for that task.
// Rules are checked in order; all matching rules contribute their tools (union).
// Returns an empty array to signal "use all tools" when no confident match is found.

interface Rule {
  pattern: RegExp;
  tools: string[];
}

const RULES: Rule[] = [
  // Git operations — checked first so "show diff" doesn't fall into file-read
  {
    pattern: /\b(git|diff|commit|push|pull|branch|merge|rebase|stash|log|status|staged|unstaged|changed files)\b/i,
    tools: ['read_file', 'list_files', 'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit', 'git_branch', 'git_stash', 'bash'],
  },
  // Web research — explicit "online/web/url/http" required to avoid matching "search in files"
  {
    pattern: /\b(search online|search the web|google|look up online|web search|fetch url|web_fetch)\b|https?:\/\//i,
    tools: ['web_search', 'web_fetch', 'read_file'],
  },
  // Shell / build / run
  {
    pattern: /\b(run|execute|install|build|compile|test|npm|yarn|pnpm|pip|python3?|node|tsx?|bash|shell|command|script|start|restart)\b/i,
    tools: ['bash', 'read_file', 'list_files', 'file_tree'],
  },
  // Grep / pattern search inside files
  {
    pattern: /\b(grep|find in|search in|search for|look for|where is|which files?|occurrences?|usages?|references?|imports?)\b/i,
    tools: ['grep', 'glob', 'list_files', 'file_tree', 'read_file'],
  },
  // Directory listing / tree
  {
    pattern: /\b(list files?|ls|tree|directory|folder|structure|what files|show files?)\b/i,
    tools: ['list_files', 'file_tree', 'glob', 'read_file'],
  },
  // File editing / creation / refactoring
  {
    pattern: /\b(edit|modify|change|update|fix|add|remove|replace|rewrite|create|write|append|insert|patch)\b/i,
    tools: ['read_file', 'write_file', 'edit_file', 'replace_block', 'list_files', 'git_diff', 'search_codebase'],
  },
  // File delete / rename / move
  {
    pattern: /\b(delete|remove|rename|move|mv|refactor)\b/i,
    tools: ['read_file', 'list_files', 'delete_file', 'rename_file', 'search_codebase', 'git_status'],
  },
  // File reading / display
  {
    pattern: /\b(read|show|display|print|view|open|cat|whats in|what is in|content of|look at|tell me about)\b/i,
    tools: ['read_file', 'list_files', 'file_tree', 'grep'],
  },
];

// Only filter when we'd remove at least this many tools — avoids negligible reductions
const MIN_REDUCTION = 2;

// Greetings, thanks, one-word acks, and simple social messages that need no tools.
const CONVERSATIONAL_RE =
  /^(hi+|hello+|hey+|hiya|howdy|sup|yo+|lol+|haha+|heh|wow+|nice|cool|(ok(ay)?)|k|sure|(thanks?(\s+you)?)|thx|ty|(you'?re\s+welcome)|(good\s+(morning|afternoon|evening|night))|(how\s+are\s+you)|(how'?s\s+it\s+going)|bye|goodbye|cya|ttyl|(take\s+care)|(see\s+you))[.!?~]*\s*$/i;

/**
 * Returns true when the input is clearly a conversational message that needs
 * no tools and no planning — greetings, acks, small talk, etc.
 */
export function isConversational(input: string): boolean {
  const t = input.trim();
  if (t.length === 0) return true;
  return CONVERSATIONAL_RE.test(t);
}

/**
 * Returns the names of tools relevant to this query.
 * Pass `totalTools` (total registered) so the function can decide if filtering is worth it.
 * An empty return means "use all tools".
 */
export function classifyIntent(input: string, totalTools: number): string[] {
  const matched = new Set<string>();

  for (const rule of RULES) {
    if (rule.pattern.test(input)) {
      rule.tools.forEach(t => matched.add(t));
    }
  }

  if (matched.size === 0 || totalTools - matched.size < MIN_REDUCTION) {
    return [];
  }

  return Array.from(matched);
}
