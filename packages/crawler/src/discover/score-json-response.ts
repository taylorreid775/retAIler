const TITLE_KEYS = /^(title|name|productname|displayname)$/i;
const PRICE_KEYS = /^(price|currentprice|saleprice|amount|lowprice)$/i;
const URL_KEYS = /^(url|link|slug|producturl|pdpurl|path)$/i;

/** Score 0..1: how likely a JSON body is a product catalog/search response. */
export function scoreJsonForProducts(text: string): number {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 0;
  }
  let best = 0;
  walk(data, (node) => {
    if (!Array.isArray(node) || node.length < 2) return;
    const objs = node.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    if (objs.length < 2) return;
    const sample = objs[0]!;
    const keys = Object.keys(sample);
    let score = 0;
    if (keys.some((k) => TITLE_KEYS.test(k))) score += 0.3;
    if (keys.some((k) => PRICE_KEYS.test(k) || nestedPrice(sample, k))) score += 0.3;
    if (keys.some((k) => URL_KEYS.test(k))) score += 0.2;
    if (objs.length >= 5) score += 0.15;
    if (objs.length >= 10) score += 0.05;
    best = Math.max(best, Math.min(1, score));
  });
  return best;
}

function nestedPrice(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (!v || typeof v !== 'object') return false;
  const nested = Object.keys(v as Record<string, unknown>);
  return nested.some((k) => PRICE_KEYS.test(k) || k === 'value');
}

function walk(node: unknown, visit: (n: unknown) => void, depth = 0): void {
  if (depth > 8 || node == null) return;
  visit(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      walk(v, visit, depth + 1);
    }
  }
}
