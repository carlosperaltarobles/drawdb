export const LAYOUT_FIELDS = ["x", "y", "width"];

const LAYOUT_FIELD_SET = new Set(LAYOUT_FIELDS);

export function sameIgnoringLayout(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!LAYOUT_FIELD_SET.has(key) && a[key] !== b[key]) return false;
  }

  return true;
}

export function tablesSameIgnoringLayout(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (!sameIgnoringLayout(a[i], b[i])) return false;
  }

  return true;
}
