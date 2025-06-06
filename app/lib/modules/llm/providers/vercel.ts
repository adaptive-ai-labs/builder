import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

export default class VercelProvider extends BaseProvider {
  name = 'Vercel';
  getApiKeyLink = 'https://vercel.com/docs/v0/api#authentication';
  labelForGetApiKey = 'Get Vercel API Key';

  config = {
    apiTokenKey: 'VERCEL_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'v0-1.0-md',
      label: 'v0-1.0 (Beta)',
      provider: 'Vercel',
      maxTokenAllowed: 128000,
    },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'VERCEL_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    // Vercel v0 API uses OpenAI-compatible format at their specific endpoint
    const baseURL = 'https://api.v0.dev/v1';

    return getOpenAILikeModel(baseURL, apiKey, model);
  }
}
