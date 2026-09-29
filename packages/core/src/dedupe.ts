import type { DedupeOptions, DedupeReason } from './types.js';
import { DEFAULT_DEDUPE } from './types.js';

export type DedupeResult = {
  text: string;
  dropped: boolean;
  reason: DedupeReason | null;
  overlapChars: number;
};

export function normalizeForCompare(
  text: string,
  options: Partial<DedupeOptions> = {},
): string {
  const opts = { ...DEFAULT_DEDUPE, ...options };
  let out = text;
  if (opts.lowercase) out = out.toLowerCase();
  if (opts.yoAsE) out = out.replace(/ё/g, 'е');
  if (opts.stripPunctuation) {
    out = out.replace(/[^\p{L}\p{N}\s]/gu, '');
  }
  if (opts.collapseWhitespace) out = out.replace(/\s+/g, ' ');
  return out.trim();
}

function stripLeadingPunctuation(text: string): string {
  return text.replace(/^[\s.,!?;:«»"'()\-–—]+/u, '');
}

export function dedupeFragment(
  incoming: string,
  tail: string,
  options: Partial<DedupeOptions> = {},
): DedupeResult {
  const opts = { ...DEFAULT_DEDUPE, ...options };
  const raw = incoming.trim();
  if (!raw) {
    return { text: '', dropped: true, reason: 'empty', overlapChars: 0 };
  }

  const tailWindow = tail.slice(-opts.tailWindowChars);
  const normIncoming = normalizeForCompare(raw, opts);
  const normTail = normalizeForCompare(tailWindow, opts);

  if (normIncoming.length >= opts.minDropChars && normTail.endsWith(normIncoming)) {
    return { text: '', dropped: true, reason: 'exact-tail', overlapChars: normIncoming.length };
  }

  let bestCut = -1;
  const maxCut = Math.min(raw.length, normIncoming.length);
  for (let cut = maxCut; cut >= 1; cut -= 1) {
    const prefix = normalizeForCompare(raw.slice(0, cut), opts);
    if (prefix.length < opts.minOverlapChars) continue;
    if (normTail.endsWith(prefix)) {
      bestCut = cut;
      break;
    }
  }

  if (bestCut > 0) {
    const remainder = stripLeadingPunctuation(raw.slice(bestCut));
    if (normalizeForCompare(remainder, opts).length === 0) {
      return {
        text: '',
        dropped: true,
        reason: 'suffix-overlap',
        overlapChars: bestCut,
      };
    }
    return {
      text: remainder,
      dropped: false,
      reason: null,
      overlapChars: bestCut,
    };
  }

  if (
    normIncoming.length >= opts.minContainChars &&
    normTail.includes(normIncoming)
  ) {
    return {
      text: '',
      dropped: true,
      reason: 'contained-in-tail',
      overlapChars: normIncoming.length,
    };
  }

  return { text: raw, dropped: false, reason: null, overlapChars: 0 };
}

export function isRecentRepeat(
  normalized: string,
  recent: readonly string[],
  minChars: number,
): boolean {
  if (normalized.length < minChars) return false;
  return recent.includes(normalized);
}
