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
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
  },

  // Use HTTP backend for Cloudflare edge environment
  backend: { type: 'http' },
});

export default i18next;
