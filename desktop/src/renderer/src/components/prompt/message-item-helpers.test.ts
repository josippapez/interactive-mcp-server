import { describe, expect, it } from 'vitest';
import { getAttachmentKey, getEffortBadge } from './message-item-helpers';

describe('getAttachmentKey', () => {
  it('disambiguates duplicate attachments in the same message', () => {
    const attachment = {
      data: 'abc',
      mimeType: 'image/png',
      name: 'image.png',
      size: 3,
    };

    expect(getAttachmentKey('db-56', attachment, 0)).toBe(
      'db-56-att-0-image.png-image/png',
    );
    expect(getAttachmentKey('db-56', attachment, 1)).toBe(
      'db-56-att-1-image.png-image/png',
    );
  });
});

describe('getEffortBadge', () => {
  it('maps known reasoning variants to visible badges', () => {
    expect(getEffortBadge('low')).toEqual({
      label: 'Low effort',
      variant: 'effort-low',
    });
    expect(getEffortBadge('XHIGH')).toEqual({
      label: 'Max effort',
      variant: 'effort-xhigh',
    });
  });

  it('returns null for unknown or missing variants', () => {
    expect(getEffortBadge()).toBeNull();
    expect(getEffortBadge('turbo')).toBeNull();
  });
});
