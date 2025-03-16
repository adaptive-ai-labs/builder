/**
 * Language utilities for managing language preferences across the application
 */

// Default language
const DEFAULT_LANGUAGE = 'en';

// Global variable to store current language
let currentLanguage = DEFAULT_LANGUAGE;

/**
 * Set the current language and save to localStorage
 */
export const setCurrentLanguage = (language: string): void => {
  currentLanguage = language;

  // Only save to localStorage in browser environment
  if (typeof window !== 'undefined') {
    localStorage.setItem('preferredLanguage', language);
  }
};

/**
 * Get the current language, initializing from localStorage if available
 */
export const getCurrentLanguage = (): string => {
  // Initialize from localStorage if in browser and not yet initialized
  if (typeof window !== 'undefined' && currentLanguage === DEFAULT_LANGUAGE) {
    const savedLanguage = localStorage.getItem('preferredLanguage');

    if (savedLanguage) {
      currentLanguage = savedLanguage;
    }
  }

  return currentLanguage;
};

/**
 * Initialize language from various sources (localStorage, cookies, URL)
 * in order of precedence
 */
export const initializeLanguage = (cookieLanguage?: string, urlLanguage?: string): string => {
  // Check localStorage first (highest precedence)
  if (typeof window !== 'undefined') {
    const localStorageLanguage = localStorage.getItem('preferredLanguage');

    if (localStorageLanguage) {
      currentLanguage = localStorageLanguage;
      return currentLanguage;
    }
  }

  // Then URL parameter
  if (urlLanguage) {
    currentLanguage = urlLanguage;
    return currentLanguage;
  }

  // Then cookie
  if (cookieLanguage) {
    currentLanguage = cookieLanguage;
    return currentLanguage;
  }

  // Default if nothing else is set
  return currentLanguage;
};
