/**
 * Lightweight skill-matching utilities.
 *
 * Given a user message and a list of registered skills, returns the strongest
 * matching skills based on lightweight token and phrase overlap. This stays
 * deterministic and cheap, but avoids flooding the prompt with weak matches.
 *
 * Design decisions:
 * - Tokenise both the query and the skill name/description by splitting on
 *   non-alphanumeric characters, lowercasing, and filtering out stop-words
 *   and very short tokens (≤ 2 chars).
 * - Matching is scored using shared tokens plus shared phrases so phrases like
 *   "pull request" outrank loose single-word overlap while still allowing a
 *   small substring fallback for close variants.
 * - Result count is capped to the strongest two matches.
 * - Only skills are matched (not instructions — those are always-active
 *   built-ins or catalog entries delivered through the startup context model).
 */

export interface SkillSummary {
  name: string;
  description: string;
}

const MAX_MATCHED_SKILLS = 2;

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

function buildPhrases(tokens: readonly string[]): string[] {
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }
  return phrases;
}

function scoreSkillMatch(
  queryTokens: readonly string[],
  queryPhrases: readonly string[],
  skill: SkillSummary,
): number {
  const nameTokens = tokenise(skill.name);
  const descriptionTokens = tokenise(skill.description);
  const skillTokens = [...new Set([...nameTokens, ...descriptionTokens])];
  if (skillTokens.length === 0) return 0;

  const haystack = `${skill.name} ${skill.description}`.toLowerCase();

  let score = 0;
  for (const phrase of queryPhrases) {
    if (haystack.includes(phrase)) {
      score += 5;
    }
  }

  for (const token of queryTokens) {
    if (nameTokens.includes(token)) {
      score += 3;
      continue;
    }
    if (descriptionTokens.includes(token)) {
      score += 2;
      continue;
    }
    if (skillTokens.some((skillToken) => skillToken.includes(token))) {
      score += 1;
    }
  }

  return score;
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

  const queryTokens = [...new Set(tokenise(userMessage))];
  if (queryTokens.length === 0) return [];
  const queryPhrases = buildPhrases(queryTokens);

  return skills
    .map((skill, index) => ({
      skill,
      index,
      score: scoreSkillMatch(queryTokens, queryPhrases, skill),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .slice(0, MAX_MATCHED_SKILLS)
    .map((entry) => entry.skill);
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
  const cappedMatches = matchedSkills.slice(0, MAX_MATCHED_SKILLS);
  if (cappedMatches.length === 0) return '';

  const suggestions = cappedMatches
    .map(
      (s) =>
        `[Skill suggestion: The user's message may relate to skill "${s.name}" — consider loading it with the skill tool.]`,
    )
    .join('\n');

  return `<system-reminder>\n${suggestions}\n</system-reminder>`;
}
