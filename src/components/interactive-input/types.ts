export interface InteractiveInputProps {
  question: string;
  questionId: string;
  predefinedOptions?: string[];
  onSubmit: (questionId: string, value: string) => void;
  onInputActivity?: () => void;
  searchRoot?: string;
}

export interface AutocompleteTarget {
  start: number;
  end: number;
  query: string;
}

export interface OpenTuiKeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  option: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface TextareaRenderableLike {
  plainText: string;
  cursorOffset: number;
  scrollY?: number;
  lineCount?: number;
  virtualLineCount?: number;
  height?: number;
  setText: (value: string) => void;
  replaceText?: (value: string) => void;
  hasSelection?: () => boolean;
  getSelectedText?: () => string;
  clearAllHighlights?: () => void;
  addHighlightByCharRange?: (highlight: {
    start: number;
    end: number;
    styleId: number;
  }) => void;
}
