import { OpenRouter } from "@openrouter/sdk";
import type { ChatResponse } from "@openrouter/sdk/models/chatresponse";

export type ChatParams = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  temperature?: number;
  maxTokens?: number;
};

export type OpenRouterClient = {
  chat(params: ChatParams): Promise<string>;
};

export function createOpenRouterClient(apiKey: string): OpenRouterClient {
  const sdk = new OpenRouter({ apiKey });

  return {
    async chat(params: ChatParams): Promise<string> {
      const response = (await sdk.chat.send({
        chatGenerationParams: {
          model: params.model,
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userPrompt },
          ],
          temperature: params.temperature ?? 0.7,
          maxTokens: params.maxTokens,
          responseFormat: params.jsonSchema
            ? {
                type: "json_schema",
                jsonSchema: {
                  name: params.jsonSchema.name,
                  schema: params.jsonSchema.schema,
                  strict: false,
                },
              }
            : undefined,
          stream: false,
        },
      })) as ChatResponse;

      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenRouter returned non-string content");
      }
      return content;
    },
  };
}
