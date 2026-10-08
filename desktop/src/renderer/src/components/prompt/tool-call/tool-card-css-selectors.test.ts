import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TOOL_GROUP_CONTAINMENT_SELECTOR,
  TOOL_CARD_CONTAINMENT_SELECTOR,
  TOOL_LOADED_FILE_PATH_SELECTOR,
} from './tool-card-css-selectors';

describe('tool card css selectors', () => {
  it('targets the tool card shell and descendants for width containment', () => {
    expect(TOOL_CARD_CONTAINMENT_SELECTOR).toContain(
      "[data-component='tool-card-shell']",
    );
    expect(TOOL_CARD_CONTAINMENT_SELECTOR).toContain('*');
  });

  it('targets loaded file path text for overflow fallback wrapping', () => {
    expect(TOOL_LOADED_FILE_PATH_SELECTOR).toBe(
      "[data-component='tool-loaded-file'] [data-slot='file-path']",
    );
  });

  it('targets grouped context tools for width containment', () => {
    expect(CONTEXT_TOOL_GROUP_CONTAINMENT_SELECTOR).toContain(
      "[data-component='context-tool-group-trigger']",
    );
    expect(CONTEXT_TOOL_GROUP_CONTAINMENT_SELECTOR).toContain(
      "[data-component='context-tool-group-list']",
    );
  });
});
