import { atom } from 'nanostores';
import { logStore } from './logs';

export type Theme = 'dark' | 'light';

export const kTheme = 'bolt_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export const DEFAULT_THEME = 'light';

export const themeStore = atom<Theme>(initStore());

function initStore(): Theme {
  // Always return light theme
  if (!import.meta.env.SSR) {
    // Set the HTML attribute to light theme
    document.querySelector('html')?.setAttribute('data-theme', 'light');

    // Set localStorage to light theme
    localStorage.setItem(kTheme, 'light');
  }

  return 'light' as Theme;
}

export function toggleTheme() {
  /*
   * No-op function that does nothing - we always want to stay in light mode
   * This function is kept to prevent breaking any code that calls it
   */
  logStore.logSystem('Theme is set to light mode');
  return;
}
