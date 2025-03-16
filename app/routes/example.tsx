import { json } from '@remix-run/cloudflare';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';

export const handle = {
  i18n: ['common'],
};

export const loader = () => json({});

export default function Example() {
  const { t } = useTranslation('common');

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold">{t('welcome')}</h1>
        <LanguageSwitcher />
      </div>

      <div className="bg-bolt-elements-background-depth-2 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">{t('description')}</h2>
        <p className="mb-4">This is an example page demonstrating how to use translations in Remix.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-bolt-elements-stroke rounded p-4">
            <h3 className="font-medium mb-2">{t('navigation.home')}</h3>
            <p className="text-bolt-content-secondary">Example of a translated navigation item.</p>
          </div>

          <div className="border border-bolt-elements-stroke rounded p-4">
            <h3 className="font-medium mb-2">{t('navigation.about')}</h3>
            <p className="text-bolt-content-secondary">Another example of a translated navigation item.</p>
          </div>

          <div className="border border-bolt-elements-stroke rounded p-4">
            <h3 className="font-medium mb-2">{t('navigation.settings')}</h3>
            <p className="text-bolt-content-secondary">Settings page translation example.</p>
          </div>

          <div className="border border-bolt-elements-stroke rounded p-4">
            <h3 className="font-medium mb-2">{t('actions.save')}</h3>
            <p className="text-bolt-content-secondary">Example of a translated action button.</p>
          </div>
        </div>
      </div>

      <div className="flex space-x-2">
        <button className="px-4 py-2 bg-blue-500 text-white rounded">{t('actions.save')}</button>
        <button className="px-4 py-2 bg-gray-300 text-gray-800 rounded">{t('actions.cancel')}</button>
      </div>
    </div>
  );
}
