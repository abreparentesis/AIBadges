import { parse as parseVtt } from "@plussub/srt-vtt-parser";

export interface Turn {
  i: number;
  speaker: string;
  start?: string;
  text: string;
}

export class ParseError extends Error {}

/** `<v Speaker Name>text` cue payload → speaker + text. */
function fromVoiceTag(text: string): { speaker?: string; text: string } {
  const m = text.match(/^<v\s+([^>]+)>\s*([\s\S]*)$/);
  if (m) return { speaker: m[1].trim(), text: m[2].replace(/<\/v>\s*$/, "").trim() };
  return { text: text.trim() };
}

/** `Speaker Name: text` prefix → speaker + text. */
function fromColonPrefix(text: string): { speaker?: string; text: string } {
  const m = text.match(/^([A-Za-z][\w .'&-]{0,40}):\s+([\s\S]+)$/);
  if (m) return { speaker: m[1].trim(), text: m[2].trim() };
  return { text: text.trim() };
}

function msToClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function mergeConsecutive(entries: { speaker: string; start?: string; text: string }[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of entries) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === e.speaker) {
      last.text += " " + e.text;
    } else {
      turns.push({ i: turns.length, speaker: e.speaker, start: e.start, text: e.text });
    }
  }
  return turns;
}

export function parseTranscript(filename: string, content: string): Turn[] {
  const lower = filename.toLowerCase();
  let turns: Turn[];
  if (lower.endsWith(".vtt") || lower.endsWith(".srt")) {
    turns = parseVttFile(content);
  } else {
    turns = parseTxt(content);
  }
  if (turns.length === 0) {
    throw new ParseError(
      `No speaker turns found in ${filename}. Expected a VTT with cues or a TXT with 'Speaker: text' lines.`,
    );
  }
  return turns;
}

function parseVttFile(content: string): Turn[] {
  let entries;
  try {
    entries = parseVtt(content).entries;
  } catch (e) {
    throw new ParseError(`Could not parse subtitle file: ${(e as Error).message}`);
  }
  let lastSpeaker = "Speaker";
  const mapped = entries
    .filter((e) => e.text.trim().length > 0)
    .map((e) => {
      const viaTag = fromVoiceTag(e.text);
      const via = viaTag.speaker ? viaTag : fromColonPrefix(e.text);
      if (via.speaker) lastSpeaker = via.speaker;
      return { speaker: via.speaker ?? lastSpeaker, start: msToClock(e.from), text: via.text };
    })
    .filter((e) => e.text.length > 0);
  return mergeConsecutive(mapped);
}

function parseTxt(content: string): Turn[] {
  const entries: { speaker: string; text: string }[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const via = fromColonPrefix(line);
    if (via.speaker) {
      entries.push({ speaker: via.speaker, text: via.text });
    } else if (entries.length > 0) {
      // continuation of the previous speaker's paragraph
      entries[entries.length - 1].text += " " + line;
    }
  }
  return mergeConsecutive(entries);
}
