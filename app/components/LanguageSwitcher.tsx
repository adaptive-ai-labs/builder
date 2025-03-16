import { useTranslation } from 'react-i18next';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { getCurrentLanguage, setCurrentLanguage } from '~/lib/common/language-utils';

export function LanguageSwitcher() {
  // Always call hooks at the top level, regardless of conditions
  const { lngs } = useLoaderData<any>();
  const { i18n, t } = useTranslation('common', { useSuspense: false });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // Initialize language from localStorage if available
    const savedLanguage = getCurrentLanguage();

    if (savedLanguage && savedLanguage !== i18n.resolvedLanguage) {
      i18n.changeLanguage(savedLanguage);
    } else {
      // If no saved language, store the current i18n language
      setCurrentLanguage(i18n.resolvedLanguage || 'en');
    }
  }, []);

  // Render a loading state if not on client yet
  if (!isClient) {
    return <div className="flex items-center space-x-2">...</div>;
  }

  return (
    <div className="flex items-center space-x-2" title={t('languageSwitcher') || 'Change language'}>
      {Object.keys(lngs).map((lng) => (
        <a
          key={lng}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            i18n.resolvedLanguage === lng
              ? 'font-bold bg-white text-gray-800 border border-gray-200'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
          href={`?lng=${lng}`}
          onClick={(e) => {
            e.preventDefault();

            // Update both i18n and our global language state
            i18n.changeLanguage(lng);
            setCurrentLanguage(lng);

            // Set a cookie that will be sent with API requests
            document.cookie = `i18next=${lng}; path=/; max-age=31536000`; // 1 year expiration

            // Update URL without full page reload
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('lng', lng);
            window.history.pushState({}, '', newUrl.toString());

            // Log for debugging
            console.log(`Language switched to: ${lng}, cookie set: i18next=${lng}`);
          }}
          aria-label={`Switch language to ${lngs[lng as keyof typeof lngs].nativeName}`}
        >
          {lngs[lng as keyof typeof lngs].nativeName}
        </a>
      ))}
    </div>
  );
}
