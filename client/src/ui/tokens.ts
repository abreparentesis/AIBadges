// Design tokens (subset), for inline styles. Hex values are the Figma token export.
export const t = {
  blue: '#0046ff', blue900: '#103d9f', blue400: '#56a4ff', blue100: '#d5f0ff', blue50: '#eff8ff',
  white: '#fff', black: '#000',
  g50: '#f9fafb', g100: '#f3f4f6', g200: '#e5e7eb', g300: '#d2d6db',
  g500: '#6c737f', g600: '#4d5761', g700: '#384250', g800: '#1f2a37', g900: '#111927',
  mint: '#3effc8', lime: '#c4ff3c', pink: '#ff5983', purple: '#5737f4',
  success: '#12b76a', successBg: '#c9ffeb', successText: '#005c4c', error: '#d92d20',
} as const;

// Per-lens accent (decorative vibrant palette).
export const lensAccent = { thinking: t.purple, capability: t.blue, trajectory: '#0e9384', type: t.purple } as const;
export const bandColor: Record<string, string> = {
  emerging: t.g500, developing: t.blue400, proficient: t.blue, advanced: t.blue900,
};
