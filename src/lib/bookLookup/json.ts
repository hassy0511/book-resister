/** 型の分からない JSON を安全にたどるための小さなヘルパ */

export type JsonRecord = Record<string, unknown>;

export function asRecord(v: unknown): JsonRecord | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : null;
}

/** 配列ならそのまま、単一の値なら 1 要素の配列、null/undefined なら空配列（ONIX の「1 件なら配列でない」対策） */
export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === null || v === undefined ? [] : [v];
}

export function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** obj.a.b.c のようにたどる（途中が無ければ undefined） */
export function pick(v: unknown, ...path: string[]): unknown {
  let cur: unknown = v;
  for (const key of path) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[key];
  }
  return cur;
}
