import Backend from 'i18next-fs-backend/cjs';
import { resolve } from 'node:path';
import { RemixI18Next } from 'remix-i18next';
import i18nextOptions from './i18nextOptions';

const i18next = new RemixI18Next({
  detection: {
    // Languages your application supports
    supportedLanguages: i18nextOptions.supportedLngs,

    // Fallback language
    fallbackLanguage: i18nextOptions.fallbackLng,
  },

  /*
   * This is the configuration for i18next used
   * when translating messages server-side only
   */
  i18next: {
    ...i18nextOptions,
    backend: {
      loadPath: resolve('./public/locales/{{lng}}/{{ns}}.json'),
    },
  },

  // The i18next plugins you want RemixI18next to use for `i18n.getFixedT` inside loaders and actions
  backend: Backend,
});

export default i18next;
