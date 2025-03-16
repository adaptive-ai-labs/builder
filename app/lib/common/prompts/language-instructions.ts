import { stripIndents } from '~/utils/stripIndent';

/**
 * Universal language-specific instructions for any LLM to respond in the specified language
 */
export const getLanguageInstructions = (language: string): string => {
  // Enhanced language map with stronger native instructions
  const languageMap: Record<
    string,
    {
      nativeName: string;
      englishInstruction: string;
      nativeInstruction: string;
      prohibitedLanguage: string;
    }
  > = {
    en: {
      nativeName: 'English',
      englishInstruction: 'You must respond only in English.',
      nativeInstruction: 'You must respond only in English.',
      prohibitedLanguage: 'Do not respond in any language other than English.',
    },
    tl: {
      nativeName: 'Tagalog',
      englishInstruction: 'You must respond only in Tagalog (Filipino).',
      nativeInstruction:
        'MAHALAGA: Sumagot ka sa TAGALOG (Filipino) lamang. Huwag kang sumagot sa Ingles kahit kailan.',
      prohibitedLanguage: 'Do not respond in English or any other language. Huwag sumagot sa Ingles o ibang wika.',
    },
    ceb: {
      nativeName: 'Bisaya',
      englishInstruction: 'You must respond only in Cebuano (Bisaya).',
      nativeInstruction: 'IMPORTANTE: Tubag sa Bisaya lang. Ayaw gyud tubag sa English.',
      prohibitedLanguage: 'Do not respond in English or any other language. Ayaw tubag sa English o laing pinulongan.',
    },
    th: {
      nativeName: 'ไทย',
      englishInstruction: 'You must respond only in Thai.',
      nativeInstruction: 'สำคัญ: กรุณาตอบเป็นภาษาไทยเท่านั้น ห้ามตอบเป็นภาษาอังกฤษเด็ดขาด',
      prohibitedLanguage: 'Do not respond in English or any other language. ห้ามตอบเป็นภาษาอังกฤษหรือภาษาอื่นๆ',
    },
  };

  // Default to English if the language is not supported
  const langInstructions = languageMap[language] || languageMap.en;

  // Create a universal prompt that works across different LLMs
  return stripIndents`
    ### LANGUAGE REQUIREMENT - ${langInstructions.nativeName.toUpperCase()} ONLY ###

    ${langInstructions.englishInstruction}
    ${langInstructions.nativeInstruction}

    ${langInstructions.prohibitedLanguage}

    This is a hard requirement. Responses must be 100% in ${langInstructions.nativeName} only.
  `;
};
