export type Theme = 'dark' | 'light';

export interface ThemeColors {
  bgOuter: string;
  bgPromptBox: string;
  bgModeTabs: string;
  bgInput: string;
  borderPrompt: string;
  borderMode: string;
  borderInputDefault: string;
  borderInputSuggestions: string;
  textPrimary: string;
  textMuted: string;
  textAccent: string;
  textAccentAlt: string;
  sendBg: string;
  sendText: string;
  progressNormal: string;
  progressCritical: string;
  modeTabActiveBg: string;
  modeTabActiveText: string;
  modeTabInactiveText: string;
  separator: string;
  clipboardError: string;
  clipboardSuccess: string;
  attachmentLabel: string;
}

export const DARK_THEME: ThemeColors = {
  bgOuter: '#000000',
  bgPromptBox: '#000000',
  bgModeTabs: '#000000',
  bgInput: '#1f1f1f',
  borderPrompt: '#00bcd4',
  borderMode: '#e07000',
  borderInputDefault: '#444444',
  borderInputSuggestions: '#00bcd4',
  textPrimary: '#e0e0e0',
  textMuted: '#808080',
  textAccent: '#00bcd4',
  textAccentAlt: '#e07000',
  sendBg: '#00bcd4',
  sendText: '#000000',
  progressNormal: '#cccc00',
  progressCritical: '#cc0000',
  modeTabActiveBg: '#e07000',
  modeTabActiveText: '#000000',
  modeTabInactiveText: '#808080',
  separator: '#3a3a3a',
  clipboardError: '#cc0000',
  clipboardSuccess: '#00aa44',
  attachmentLabel: '#cccc00',
};

export const LIGHT_THEME: ThemeColors = {
  bgOuter: '#f5f5f5',
  bgPromptBox: '#e8e8e8',
  bgModeTabs: '#dedede',
  bgInput: '#eeeeee',
  borderPrompt: '#007a99',
  borderMode: '#cc5500',
  borderInputDefault: '#999999',
  borderInputSuggestions: '#007a99',
  textPrimary: '#111111',
  textMuted: '#555555',
  textAccent: '#007a99',
  textAccentAlt: '#cc5500',
  sendBg: '#007a99',
  sendText: '#ffffff',
  progressNormal: '#887700',
  progressCritical: '#cc0000',
  modeTabActiveBg: '#cc5500',
  modeTabActiveText: '#ffffff',
  modeTabInactiveText: '#555555',
  separator: '#aaaaaa',
  clipboardError: '#cc0000',
  clipboardSuccess: '#006622',
  attachmentLabel: '#887700',
};

export const THEMES: Record<Theme, ThemeColors> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};
