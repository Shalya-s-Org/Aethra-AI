// LLM prompt construction from the structured persona. No LLM is called here
// (and none is called anywhere yet by design) — this builds the exact system
// and user prompts a future writer model would receive, deterministically from
// the persona definition, so the persona genuinely shapes prompt construction.

import type { Persona } from './types';

function bullet(items: string[]): string {
  return items.map(i => `- ${i}`).join('\n');
}

/** The persona's standing system prompt: who Ada is and how she writes. */
export function buildSystemPrompt(persona: Persona): string {
  const sections: string[] = [
    `You are ${persona.name}. ${persona.identity}`,
    `## Mission\n${persona.mission}`,
    `## Expertise\n${bullet(persona.expertise)}`,
    `## Target audience\n${bullet(persona.targetAudience)}`,
    `## Editorial pillars\n${bullet(
      persona.editorialPillars.map(p => `${p.label}: ${p.description}`)
    )}`,
    `## Recurring themes\n${bullet(persona.recurringThemes)}`,
    `## Decision framework (strong opinions)\n${bullet(
      persona.strongOpinions.map(o => o.stance)
    )}`,
    `## Topics you never cover\n${bullet(persona.topicsToAvoid)}`,
    `## Writing style\n${bullet(persona.styleRules)}`,
    `## Required post structure\n${persona.postStructure
      .map(s => `### ${s.label}\n${s.description}${s.required ? ' (REQUIRED)' : ''}`)
      .join('\n')}`,
    `## Confidence and uncertainty rules\n- High confidence: ${persona.confidenceRules.high}\n- Medium confidence: ${persona.confidenceRules.medium}\n- Low confidence: ${persona.confidenceRules.low}`
  ];
  return sections.join('\n\n');
}

export interface PostPromptInput {
  title: string;
  summary: string;
  canonicalUrl: string;
  sourceName: string;
  /** Memory context: same-story follow-up + how new evidence relates. */
  followUp?: { story: string; relation: 'confirms' | 'updates' | 'contradicts' };
  /** Matching persona themes (from memory retrieval / scoring). */
  themes?: string[];
}

/** The per-post prompt: system (persona) + user (the candidate + memory). */
export function buildPostPrompt(persona: Persona, input: PostPromptInput): { system: string; user: string } {
  const memoryLines: string[] = [];
  if (input.followUp) {
    memoryLines.push(
      `This is a follow-up on a story you already covered: "${input.followUp.story}". The new evidence ${input.followUp.relation} your prior stance. Lead with what is genuinely new; do not re-publish the earlier content.`
    );
  }
  if (input.themes && input.themes.length > 0) {
    memoryLines.push(`Recurring themes this item touches: ${input.themes.join(', ')}.`);
  }

  const user = [
    `Write a post for ${persona.name}'s publication following the required structure exactly.`,
    `## Candidate\n- Title: ${input.title}\n- Summary: ${input.summary}\n- Source: ${input.sourceName}\n- Canonical URL: ${input.canonicalUrl}`,
    memoryLines.length > 0 ? `## Memory context\n${memoryLines.join('\n')}` : '',
    `Output ONLY the post body (no preamble), in calm, evidence-bound, hype-skeptical prose, with the required sections.`
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system: buildSystemPrompt(persona), user };
}
