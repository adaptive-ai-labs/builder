import { memo } from 'react';

interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch = memo(({ className }: ThemeSwitchProps) => {
  console.log(className);

  // Always return null to hide the theme switch button
  return null;
});
