// Server-side LLM post generation. Public surface: the provider interface and
// factory, the deterministic schema validation, and the generation orchestrator
// (repair → retry → validate → fail-without-publish).

export type { LlmProvider, LlmProviderResult, GeneratedPost } from './types';
export { createLlmProvider, LocalDeterministicProvider, FailingProvider, OpenAiCompatibleProvider } from './providers';
export { validateGeneratedPost, allowedNumbersOf, numberTokensOf, type GenerationContext, type ValidationResult } from './schema';
export { generatePost, repairJsonString, type GenerationInput, type GenerationOutcome } from './generate';
