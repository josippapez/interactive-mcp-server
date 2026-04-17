import { describe, it, expect } from 'vitest';
import { errorMessage, errWithCause } from './errors';

describe('errorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns Error.message for Error subclasses', () => {
    class MyError extends Error {}
    expect(errorMessage(new MyError('sub'))).toBe('sub');
  });

  it('stringifies plain strings', () => {
    expect(errorMessage('oops')).toBe('oops');
  });

  it('stringifies numbers', () => {
    expect(errorMessage(42)).toBe('42');
  });

  it('stringifies null and undefined', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('stringifies objects', () => {
    expect(errorMessage({ a: 1 })).toBe('[object Object]');
  });
});

describe('errWithCause', () => {
  it('returns an Error with the supplied message', () => {
    const e = errWithCause('wrapper', new Error('inner'));
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('wrapper');
  });

  it('attaches the cause property', () => {
    const inner = new Error('inner');
    const e = errWithCause('wrapper', inner);
    expect(e.cause).toBe(inner);
  });

  it('accepts non-Error causes', () => {
    const e = errWithCause('wrapper', 'string-cause');
    expect(e.cause).toBe('string-cause');
  });
});
