import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';

describe('desktop packaging metadata', () => {
  it('uses Eden as the packaged product name', () => {
    expect(packageJson.build.productName).toBe('Eden');
  });

  it('uses Eden identifiers for packaged desktop builds', () => {
    expect(packageJson.build.appId).toBe('com.rawwee.eden');
  });
});
