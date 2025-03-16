export default {
  debug: process.env.NODE_ENV !== 'production',
  fallbackLng: 'en',
  supportedLngs: ['en', 'tl', 'ceb', 'th'], // English, Tagalog, Cebuano (Bisaya), Thai
  defaultNS: 'common',
  react: { useSuspense: false },
};
