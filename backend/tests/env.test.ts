import { expect, it } from 'vitest';
import { readStartupEnv } from '../src/config/env.js';

it('applies the existing local defaults and accepts an explicit port and MongoDB URI', () => {
  expect(readStartupEnv({})).toEqual({
    port: 4000,
    mongoUri: 'mongodb://127.0.0.1:27017/watch_party',
  });
  const mongoUri = 'mongodb+srv://example.net/watch_party';
  expect(readStartupEnv({ PORT: '10000', MONGODB_URI: mongoUri })).toEqual({ port: 10000, mongoUri });
});

it('rejects invalid configuration without including values in the error', () => {
  expect(() => readStartupEnv({ PORT: '10000bad', MONGODB_URI: 'https://private:secret@example.net' }))
    .toThrow(/^Invalid startup configuration: PORT, MONGODB_URI$/);
});
