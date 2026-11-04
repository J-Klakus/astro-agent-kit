export interface RobotsPatch {
  text: string;
  changed: boolean;
}

/**
 * Append a `Schemamap:` directive, creating robots.txt when allowed. Existing
 * directives for the same URL are left untouched.
 */
export function ensureSchemamap(
  existing: string | null,
  url: string,
  create: boolean,
): RobotsPatch | null {
  const directive = `Schemamap: ${url}`;
  if (existing === null) {
    if (!create) return null;
    return {
      text: `User-agent: *\nAllow: /\n\n${directive}\n`,
      changed: true,
    };
  }

  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const already = new RegExp(`^\\s*schemamap:\\s*${escaped}\\s*$`, "im");
  if (already.test(existing)) return { text: existing, changed: false };

  const base = existing.trimEnd();
  return {
    text: `${base}${base ? "\n\n" : ""}${directive}\n`,
    changed: true,
  };
}
