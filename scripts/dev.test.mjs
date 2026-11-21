import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectService } from './dev.mjs';

test('recognizes existing services without confusing unrelated occupied ports', async () => {
  let body = JSON.stringify({ ok: true, uptimeSec: 10 });
  const server = createServer((_request, response) => response.end(body));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  try {
    assert.equal(await inspectService(port, 'backend'), 'running');
    body = JSON.stringify({ ok: true });
    assert.equal(await inspectService(port, 'backend'), 'occupied');
    body = '<title>Watch Party</title><script src="/@vite/client"></script>';
    assert.equal(await inspectService(port, 'frontend'), 'running');
    body = '<title>Another app</title>';
    assert.equal(await inspectService(port, 'frontend'), 'occupied');
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.equal(await inspectService(port, 'backend'), 'free');
});
