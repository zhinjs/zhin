---
"@zhin.js/ai": patch
---

Ask DeepSeek for structured replies by instruction instead of JSON mode. Its thinking models in `response_format: json_object` mode often thought and then returned only whitespace (4 of 8 chat replies failed with "Model did not produce the requested structured output"); with the schema in the system prompt and lenient decoding of the answer, 12 of 12 succeeded. `compat.structuredOutput: native | prompt` overrides the default on any provider.
