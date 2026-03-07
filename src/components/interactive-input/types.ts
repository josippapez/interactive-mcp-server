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
}

export interface TextareaRenderableLike {
  plainText: string;
  cursorOffset: number;
  setText: (value: string) => void;
  replaceText?: (value: string) => void;
}
