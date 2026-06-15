## SDK (OpenAI-compatible)

 - Use function calling style: name the deferred tool_query explicitly in run_deferred_task arguments.
 - Break multi-step goals into sequential run_deferred_task calls with short goals per step.
