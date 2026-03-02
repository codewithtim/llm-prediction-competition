-- Store raw LLM output for debugging parse failures
ALTER TABLE `competitor_versions` ADD `raw_llm_output` text;
