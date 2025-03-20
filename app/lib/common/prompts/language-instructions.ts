import { stripIndents } from '~/utils/stripIndent';

/**
 * Universal language-specific instructions for any LLM to respond in the specified language
 * while allowing technical terms and programming concepts to remain in their original form
 */
export const getLanguageInstructions = (language: string): string => {
  // Enhanced language map with stronger native instructions
  const languageMap: Record<
    string,
    {
      nativeName: string;
      englishInstruction: string;
      nativeInstruction: string;
      technicalTermsNote: string;
    }
  > = {
    en: {
      nativeName: 'English',
      englishInstruction: 'You must respond only in English.',
      nativeInstruction: 'You must respond only in English.',
      technicalTermsNote: 'Technical terms and programming concepts can be used as is.',
    },
    tl: {
      nativeName: 'Tagalog',
      englishInstruction: 'You must respond primarily in Tagalog (Filipino).',
      nativeInstruction:
        'MAHALAGA: Sumagot ka sa TAGALOG (Filipino) lamang, maliban sa mga programming at technical terms.',
      technicalTermsNote:
        'Any programming-related terms, technical concepts, framework names, library names, programming languages, code snippets, file names, and technical jargon should remain in their original form.',
    },
    ceb: {
      nativeName: 'Bisaya',
      englishInstruction: 'You must respond primarily in Cebuano (Bisaya).',
      nativeInstruction: 'IMPORTANTE: Tubag sa Bisaya lang, gawas sa mga programming ug technical terms.',
      technicalTermsNote:
        'Any programming-related terms, technical concepts, framework names, library names, programming languages, code snippets, file names, and technical jargon should remain in their original form.',
    },
    th: {
      nativeName: 'ไทย',
      englishInstruction: 'You must respond primarily in Thai.',
      nativeInstruction: 'สำคัญ: กรุณาตอบเป็นภาษาไทยเท่านั้น ยกเว้นคำศัพท์ทางเทคนิคและการเขียนโปรแกรม',
      technicalTermsNote:
        'Any programming-related terms, technical concepts, framework names, library names, programming languages, code snippets, file names, and technical jargon should remain in their original form.',
    },
  };

  // Default to English if the language is not supported
  const langInstructions = languageMap[language] || languageMap.en;

  // Create a universal prompt that works across different LLMs
  return stripIndents`
    ### LANGUAGE REQUIREMENT - ${langInstructions.nativeName.toUpperCase()} ONLY ###

    ${langInstructions.englishInstruction}
    ${langInstructions.nativeInstruction}

    ${langInstructions.technicalTermsNote}

    This is a hard requirement. Responses must be in ${langInstructions.nativeName}, except for technical terms, programming concepts, and code examples which can remain in their original form.
  `;
};
