// Polyfill for react-dnd to prevent window is not defined error
if (typeof window === 'undefined') {
  /*
   * Hack to get around react-dnd + vite issue
   * @ts-ignore
   */
  globalThis.global = globalThis;
}

import { useStore } from '@nanostores/react';
import type { LinksFunction, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect, lazy, Suspense } from 'react';

// DndProvider is imported in the client-only component
import { useChangeLanguage } from 'remix-i18next';
import i18next from './i18n.server';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let locale;

  try {
    locale = await i18next.getLocale(request);
  } catch (error) {
    console.error('Error getting locale:', error);
    locale = 'en';
  }

  return json({
    locale,
    lngs: {
      en: { nativeName: 'English' },
      tl: { nativeName: 'Tagalog' },
      ceb: { nativeName: 'Bisaya' },
      th: { nativeName: 'ไทย' },
    },
  });
};

export const handle = {
  i18n: ['common'],
};

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <ClientOnly fallback={<>{children}</>}>
        {() => {
          // Using dynamic import to avoid 'require is not defined' error
          const DndProviderClient = lazy(() => import('~/components/DndProviderClient.client'));
          return (
            <Suspense fallback={<>{children}</>}>
              <DndProviderClient>{children}</DndProviderClient>
            </Suspense>
          );
        }}
      </ClientOnly>
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

import { logStore } from './lib/stores/logs';

export default function App() {
  const theme = useStore(themeStore);
  const { locale } = useLoaderData<typeof loader>();

  // Change the i18n instance language to the current locale
  useChangeLanguage(locale);

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      locale,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });
  }, []);

  // Create a lazy-loaded component for LanguageSwitcher
  const LazyLanguageSwitcher = lazy(() =>
    import('~/components/LanguageSwitcher').then((module) => ({
      default: module.LanguageSwitcher,
    })),
  );

  return (
    <Layout>
      <div className="fixed top-2 right-4 z-50">
        {/* Import is done in the Layout component to avoid circular dependencies */}
        <ClientOnly fallback={<div>Loading...</div>}>
          {() => (
            <Suspense fallback={<div>Loading...</div>}>
              <LazyLanguageSwitcher />
            </Suspense>
          )}
        </ClientOnly>
      </div>
      <Outlet />
    </Layout>
  );
}
