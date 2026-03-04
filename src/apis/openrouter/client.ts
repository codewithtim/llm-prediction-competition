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
      let response: ChatResponse;
      try {
        response = (await sdk.chat.send({
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
      } catch (err) {
        if (err instanceof Error && "statusCode" in err) {
          const sdkErr = err as { statusCode: number; body?: string };
          let detail = err.message;
          if (sdkErr.body) {
            try {
              const parsed = JSON.parse(sdkErr.body);
              const meta = parsed?.error?.metadata;
              if (meta?.raw) {
                // Upstream provider error is JSON-encoded in metadata.raw
                try {
                  const upstream = JSON.parse(meta.raw);
                  const providerMsg = upstream?.error?.message ?? meta.raw;
                  detail = `[${meta.provider_name ?? "provider"}] ${providerMsg}`;
                } catch {
                  detail = meta.raw;
                }
              } else {
                detail = parsed?.error?.message ?? sdkErr.body;
              }
            } catch {
              detail = sdkErr.body;
            }
          }
          throw new Error(
            `OpenRouter API error (HTTP ${sdkErr.statusCode}, model: ${params.model}): ${detail}`,
          );
        }
        throw err;
      }

      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenRouter returned non-string content");
      }
      return content;
    },
  };
}
