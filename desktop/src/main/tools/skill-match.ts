/**
 * Lightweight skill-matching utilities.
 *
 * Given a user message and a list of registered skills, returns all skills
 * whose name or description contains at least one significant keyword from
 * the message. This is intentionally simple — no LLM, no heavy NLP — just
 * tokenised substring matching.
 *
 * Design decisions:
 * - Tokenise both the query and the skill name/description by splitting on
 *   non-alphanumeric characters, lowercasing, and filtering out stop-words
 *   and very short tokens (≤ 2 chars).
 * - A skill "matches" when at least one query token appears as a substring
 *   inside the skill name or description token set.
 * - Only skills are matched (not instructions — those are always-active
 *   policies already injected in full).
 */

export interface SkillSummary {
  name: string;
  description: string;
}

/** Tokens that are too generic to be meaningful signal words. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'it',
  'its',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'that',
  'this',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'not',
  'no',
  'use',
  'using',
  'also',
  'if',
  'so',
  'up',
  'out',
  'how',
  'what',
  'when',
  'where',
  'who',
  'which',
  'all',
  'any',
  'more',
  'some',
  'into',
  'about',
  'than',
  'then',
  'there',
  'here',
]);

/** Minimum token length to consider significant. */
const MIN_TOKEN_LEN = 3;

/**
 * Tokenise a string: split on non-alphanumeric boundaries, lowercase,
 * filter stop-words and short tokens.
 */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOP_WORDS.has(t));
}

/**
 * Return all skills from `skills` whose name or description shares at least
 * one significant keyword with `userMessage`.
 *
 * Returns an empty array when there are no skills, no query tokens, or no
 * matches.
 */
export function matchSkillsForMessage(
  userMessage: string,
  skills: SkillSummary[],
): SkillSummary[] {
  if (skills.length === 0) return [];

  const queryTokens = tokenise(userMessage);
  if (queryTokens.length === 0) return [];

  return skills.filter((skill) => {
    const skillTokens = tokenise(`${skill.name} ${skill.description}`);
    return queryTokens.some((qt) =>
      skillTokens.some((st) => st.includes(qt) || qt.includes(st)),
    );
  });
}

/**
 * Build the skill-suggestion prefix text to prepend to a user message when
 * one or more skill matches are found.
 *
 * Format:
 * ```
 * <system-reminder>
 * [Skill suggestion: The user's message may relate to skill "skill-name" — consider loading it with the skill tool.]
 * </system-reminder>
 * ```
 */
export function buildSkillSuggestionText(
  matchedSkills: SkillSummary[],
): string {
  if (matchedSkills.length === 0) return '';

  const suggestions = matchedSkills
    .map(
      (s) =>
        `[Skill suggestion: The user's message may relate to skill "${s.name}" — consider loading it with the skill tool.]`,
    )
    .join('\n');

  return `<system-reminder>\n${suggestions}\n</system-reminder>`;
}
