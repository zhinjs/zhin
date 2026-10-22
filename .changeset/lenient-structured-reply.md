---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Accept structured replies that miss the strict format instead of failing the turn: a JSON object wrapped in a sentence or code fence, or with a bracket too many or too few, is repaired and still validated against the schema; a plain prose answer is sent as one text message. MiniMax often writes the structured answer as text, and these cases used to reach users as "Model did not produce the requested structured output".
