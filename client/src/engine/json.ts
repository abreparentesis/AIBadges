export function parseJsonResponse(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to a best-effort brace/bracket slice for JSON embedded in prose
  }
  const start = trimmed.search(/[{[]/);
  if (start === -1) throw new Error('no JSON found in model response');
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (end === -1 || end < start) throw new Error('no JSON found in model response');
  return JSON.parse(trimmed.slice(start, end + 1));
}
