import { describe, expect, it } from 'bun:test';
import { isValidElement, type ReactNode, type ReactElement } from 'react';

import { InputEditor } from './sections.js';
import { routeTextareaMouseScroll } from './scroll-routing.js';

type MouseScrollableElement = ReactElement<{
  children?: ReactNode;
  onMouseScroll?: (event: {
    scroll?: { direction: 'up' | 'down' | 'left' | 'right' };
    stopPropagation?: () => void;
  }) => void;
}>;

const findElementByType = (
  node: ReactNode,
  type: string,
): MouseScrollableElement | null => {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, type);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  const element = node as MouseScrollableElement;

  if (element.type === type) {
    return element;
  }

  return findElementByType(element.props.children, type);
};

const renderInputEditor = () =>
  InputEditor({
    questionId: 'q1',
    textareaRenderVersion: 0,
    textareaRef: { current: null },
    textareaContainerHeight: 12,
    textareaRows: 10,
    hasSuggestions: false,
    keyBindings: [],
    onFocusRequest: () => {},
    onContentSync: () => {},
    onSubmitFromTextarea: () => {},
  });

describe('InputEditor mouse scroll routing', () => {
  it('registers onMouseScroll on textarea to keep wheel events local', () => {
    const editorTree = renderInputEditor();
    const textarea = findElementByType(editorTree, 'textarea');

    expect(textarea).not.toBeNull();
    expect(typeof textarea?.props.onMouseScroll).toBe('function');
  });

  it('stops mouse scroll event propagation from textarea when direction can still scroll', () => {
    const editorTree = renderInputEditor();
    const textarea = findElementByType(editorTree, 'textarea');

    if (!textarea) {
      throw new Error('Textarea was not rendered');
    }

    let didStopPropagation = false;
    textarea.props.onMouseScroll?.({
      scroll: { direction: 'down' },
      stopPropagation: () => {
        didStopPropagation = true;
      },
    });

    expect(didStopPropagation).toBe(true);
  });
});

describe('routeTextareaMouseScroll', () => {
  it('bubbles upward scroll at top boundary', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'up' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 0,
        virtualLineCount: 20,
        height: 10,
      },
    );

    expect(didStopPropagation).toBe(false);
  });

  it('bubbles downward scroll at bottom boundary', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'down' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 10,
        virtualLineCount: 20,
        height: 10,
      },
    );

    expect(didStopPropagation).toBe(false);
  });

  it('keeps propagation inside textarea when there is scroll room', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'down' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 2,
        virtualLineCount: 20,
        height: 10,
      },
    );

    expect(didStopPropagation).toBe(true);
  });

  it('keeps scroll local when textarea metrics are missing', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'down' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 0,
        virtualLineCount: 20,
      },
    );

    expect(didStopPropagation).toBe(true);
  });

  it('keeps scroll local when textarea state is unavailable', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll({
      scroll: { direction: 'up' },
      stopPropagation: () => {
        didStopPropagation = true;
      },
    });

    expect(didStopPropagation).toBe(true);
  });

  it('keeps upward scroll local when scroll position is unavailable', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'up' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        virtualLineCount: 20,
        height: 10,
      },
    );

    expect(didStopPropagation).toBe(true);
  });

  it('keeps downward scroll local when near bottom but not exactly at boundary', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'down' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 9.99,
        virtualLineCount: 20,
        height: 10,
      },
    );

    expect(didStopPropagation).toBe(true);
  });

  it('keeps downward scroll local when virtual lines under-report available content', () => {
    let didStopPropagation = false;

    routeTextareaMouseScroll(
      {
        scroll: { direction: 'down' },
        stopPropagation: () => {
          didStopPropagation = true;
        },
      },
      {
        scrollY: 0,
        virtualLineCount: 4,
        lineCount: 20,
        height: 4,
      },
    );

    expect(didStopPropagation).toBe(true);
  });
});
