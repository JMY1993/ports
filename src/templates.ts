import { openDB, closeDB } from './db';

export interface TemplateStringRow {
  id: number;
  template: string;
  vars: string;  // JSON string with sorted keys
  value: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateStringInfo {
  template: string;
  vars: Record<string, string>;
  value: string;
  created_at: string;
  updated_at: string;
}

/**
 * Normalize vars object: sort keys and return JSON string
 * This ensures consistent ordering for uniqueness checks
 */
export function normalizeVars(vars: Record<string, string>): string {
  const sorted = Object.keys(vars).sort().reduce((acc, key) => {
    acc[key] = vars[key];
    return acc;
  }, {} as Record<string, string>);
  return JSON.stringify(sorted);
}

/**
 * Extract placeholders from template
 * E.g., "sqlite://{project}/{branch}/{use}" → ["project", "branch", "use"]
 */
export function extractPlaceholders(template: string): string[] {
  const matches = template.match(/{([^}]+)}/g) || [];
  return matches.map(m => m.slice(1, -1));
}

/**
 * Render template with vars
 * E.g., renderTemplate("sqlite://{project}/{branch}", {project: "a", branch: "b"}) → "sqlite://a/b"
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;

  // Check all placeholders have corresponding vars
  const placeholders = extractPlaceholders(template);
  for (const placeholder of placeholders) {
    if (!(placeholder in vars)) {
      throw new Error(`Missing variable: ${placeholder}`);
    }
    result = result.replace(`{${placeholder}}`, vars[placeholder]);
  }

  return result;
}

/**
 * Claim a template instance (idempotent: create-or-return)
 */
export async function claimTemplate(
  dbPath: string | undefined,
  template: string,
  vars: Record<string, string>
): Promise<string> {
  const normalizedVars = normalizeVars(vars);
  const renderedValue = renderTemplate(template, vars);

  const ctx = openDB(dbPath);
  try {
    // Check if already exists
    const existing = ctx.db.prepare(
      'SELECT value FROM template_strings WHERE template = ? AND vars = ?'
    ).get(template, normalizedVars) as { value: string } | undefined;

    if (existing) {
      // Already exists → return existing value (idempotent)
      return existing.value;
    }

    // Doesn't exist → create new
    ctx.db.prepare(
      'INSERT INTO template_strings (template, vars, value) VALUES (?, ?, ?)'
    ).run(template, normalizedVars, renderedValue);

    return renderedValue;
  } finally {
    closeDB(ctx);
  }
}

/**
 * List template instances with optional template filter
 */
export function listTemplateStrings(
  dbPath: string | undefined,
  filterTemplate?: string
): TemplateStringInfo[] {
  const ctx = openDB(dbPath);
  try {
    let rows: TemplateStringRow[];

    if (filterTemplate) {
      rows = ctx.db.prepare(
        'SELECT * FROM template_strings WHERE template = ? ORDER BY created_at'
      ).all(filterTemplate) as TemplateStringRow[];
    } else {
      rows = ctx.db.prepare(
        'SELECT * FROM template_strings ORDER BY created_at'
      ).all() as TemplateStringRow[];
    }

    return rows.map(row => ({
      template: row.template,
      vars: JSON.parse(row.vars),
      value: row.value,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } finally {
    closeDB(ctx);
  }
}

/**
 * Delete a template instance
 */
export function deleteTemplateString(
  dbPath: string | undefined,
  template: string,
  vars: Record<string, string>
): boolean {
  const normalizedVars = normalizeVars(vars);

  const ctx = openDB(dbPath);
  try {
    const result = ctx.db.prepare(
      'DELETE FROM template_strings WHERE template = ? AND vars = ?'
    ).run(template, normalizedVars);

    return (result.changes ?? 0) > 0;
  } finally {
    closeDB(ctx);
  }
}

/**
 * Helper to parse CLI variables into Record<string, string>
 * Used by commands that accept --key value pairs
 */
export function parseCliVars(cliArgs: Record<string, any>): Record<string, string> {
  const vars: Record<string, string> = {};
  const builtinKeys = new Set(['template', 'json', 'db', 'h', 'help', 'v', 'version', 'parent', 'commands']);

  for (const [key, value] of Object.entries(cliArgs)) {
    // Skip built-in CLI options and template
    if (!builtinKeys.has(key) && typeof value === 'string') {
      vars[key] = value;
    }
  }

  return vars;
}
