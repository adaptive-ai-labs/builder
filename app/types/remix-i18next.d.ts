declare module 'remix-i18next' {
  import type { TFunction } from 'i18next';
  import type { Request } from '@remix-run/node';

  export interface RemixI18NextOptions {
    detection: {
      supportedLanguages: string[];
      fallbackLanguage: string;
    };
    i18next?: Record<string, any>;
    backend: any;
  }

  export class RemixI18Next {
    constructor(options: RemixI18NextOptions);
    getLocale(request: Request): Promise<string>;
    getFixedT(request: Request, ns?: string | string[]): Promise<TFunction>;
    getRouteNamespaces(context: any): string[];
  }

  export function useChangeLanguage(locale: string): void;
  export function getInitialNamespaces(): string[];
}
