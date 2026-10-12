// Is a judge's "evidence" really a quote from the artifact?

const PLACEHOLDERS = new Set(['', 'n/a', 'na', 'none', 'null', 'nil', 'tbd', 'todo', '-', '--', 'see above', 'see reason', 'as above', 'same', 'yes', 'no']);

/** A quote shorter than this proves nothing: single words appear in any text. */
export const MIN_QUOTE = 12;

/** Collapse whitespace and quote marks so a quote matches the artifact even when the judge re-wrapped it. */
export function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Fragments the judge put in quotes or backticks, longest first. */
export function quotedFragments(evidence: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|`([^`]+)`|“([^”]+)”|„([^”“]+)[”“]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(evidence)) !== null) out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim());
  return out.filter(Boolean).sort((x, y) => y.length - x.length);
}

export interface EvidenceCheck {
  ok: boolean;
  why: string;
}

/**
 * Evidence counts only when it quotes the artifact: a quoted fragment of at least
 * MIN_QUOTE characters that is found in the text. A line number alone, a placeholder,
 * an opinion, a quote from another file or a quote too short to be specific does not
 * count, so it cannot reopen a criterion that passed.
 */
export function checkEvidence(evidence: string | undefined, artifact: string): EvidenceCheck {
  const raw = (evidence ?? '').trim();
  if (PLACEHOLDERS.has(raw.toLowerCase())) return { ok: false, why: 'no evidence given' };

  const text = normalize(artifact);
  const fragments = quotedFragments(raw);
  const candidates = fragments.length ? fragments : [raw];
  let longEnough = 0;
  for (const f of candidates) {
    const n = normalize(f);
    if (n.length < MIN_QUOTE) continue;
    longEnough++;
    if (text.includes(n)) {
      // When the whole evidence is in the artifact, show all of it, not just the backticked fragment that matched first.
      const shown = fragments.length && text.includes(normalize(raw)) ? raw : f;
      const clipped = shown.length > 120 ? `${shown.slice(0, 60)} ... ${shown.slice(-55)}` : shown;
      return { ok: true, why: `quote found in the artifact: "${clipped}"` };
    }
  }
  if (longEnough === 0) return { ok: false, why: `no quote of at least ${MIN_QUOTE} characters; a line number or a single word is not evidence` };
  return { ok: false, why: fragments.length ? 'quoted text not found in the artifact' : 'evidence text not found in the artifact' };
}
