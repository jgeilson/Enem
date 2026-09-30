import { jsonrepair } from 'jsonrepair';

/**
 * Safely parses any LLM output string into valid JSON, recovering from:
 * - Markdown backticks
 * - Unescaped quotes inside strings
 * - Invalid LaTeX / backslash escape sequences
 * - Missing commas or brackets ("Expected ',' or '}' after property value")
 * - Truncated responses (recovers all complete question objects)
 */
export function safeParseJson<T = any>(rawInput: string): T {
  if (!rawInput || typeof rawInput !== 'string') {
    return [] as unknown as T;
  }

  let cleaned = rawInput.trim();

  // Strip Markdown code blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
    cleaned = cleaned.trim();
  }

  // 1. Try standard JSON.parse first (fast path)
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // 2. Try jsonrepair (fixes unescaped quotes, unescaped newlines, invalid escape sequences, missing commas)
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired);
    } catch (e2) {
      // 3. If truncated mid-stream, recover all completed objects in the array
      const lastObjClose = cleaned.lastIndexOf('},');
      if (lastObjClose !== -1) {
        const sliced = cleaned.slice(0, lastObjClose + 1) + ']';
        try {
          const repairedSlice = jsonrepair(sliced);
          return JSON.parse(repairedSlice);
        } catch {
          try {
            return JSON.parse(sliced);
          } catch {
            // continue
          }
        }
      }

      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1) {
        const sliced = cleaned.slice(0, lastBrace + 1) + ']';
        try {
          const repairedSlice = jsonrepair(sliced);
          return JSON.parse(repairedSlice);
        } catch {
          try {
            return JSON.parse(sliced);
          } catch {
            // continue
          }
        }
      }

      // Re-throw if completely unrecoverable
      throw e1;
    }
  }
}
