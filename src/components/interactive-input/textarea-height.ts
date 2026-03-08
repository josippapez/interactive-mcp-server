const NARROW_TERMINAL_MIN_ROWS = 4;
const WIDE_TERMINAL_MIN_ROWS = 5;
const NARROW_TERMINAL_MAX_ROWS = 8;
const WIDE_TERMINAL_MAX_ROWS = 12;

interface TextareaHeightOptions {
  value: string;
  width: number;
  terminalHeight: number;
  isNarrow: boolean;
}

interface TextareaDimensions {
  rows: number;
  containerHeight: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const countVisualColumns = (line: string): number => {
  if (line.length === 0) {
    return 0;
  }

  return line.replace(/\t/g, '    ').length;
};

const estimateWrappedRows = (
  value: string,
  availableColumns: number,
): number => {
  const normalizedValue = value.replace(/\r\n/g, '\n');
  const lines = normalizedValue.split('\n');

  return lines.reduce((totalRows, line) => {
    const visualColumns = countVisualColumns(line);
    const lineRows = Math.max(1, Math.ceil(visualColumns / availableColumns));
    return totalRows + lineRows;
  }, 0);
};

export const getTextareaDimensions = ({
  value,
  width,
  terminalHeight,
  isNarrow,
}: TextareaHeightOptions): TextareaDimensions => {
  const minRows = isNarrow ? NARROW_TERMINAL_MIN_ROWS : WIDE_TERMINAL_MIN_ROWS;
  const maxRows = isNarrow ? NARROW_TERMINAL_MAX_ROWS : WIDE_TERMINAL_MAX_ROWS;

  const reservedChromeRows = isNarrow ? 24 : 20;
  const maxContainerHeight = Math.max(6, terminalHeight - reservedChromeRows);
  const terminalSafeMaxRows = Math.max(
    minRows,
    Math.min(maxRows, maxContainerHeight - 2),
  );

  const estimatedPadding = isNarrow ? 14 : 18;
  const availableColumns = Math.max(14, width - estimatedPadding);
  const estimatedRows = estimateWrappedRows(value, availableColumns);
  const rows = clamp(estimatedRows, minRows, terminalSafeMaxRows);

  return {
    rows,
    containerHeight: rows + 2,
  };
};
