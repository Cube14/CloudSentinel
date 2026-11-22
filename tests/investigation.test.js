'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { investigate } = require('../server/investigation');

test('investigation uses recorded evidence and falls back for invalid model output', async t => {
  const incident = { summary: 'One alert fired', events: [
    { actor: 'test-user', action: 'ListBuckets', timestamp: '2026-11-22T08:00:00Z' }
  ] };
  let answer = { hypotheses: ['Check whether listing was expected'], recommendations: ['Confirm with the actor'] };
  let prompt;
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    prompt = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: JSON.stringify(answer) }));
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const env = { OLLAMA_URL: 'http://127.0.0.1:' + mock.address().port };
  const valid = await investigate(incident, env);
  assert.equal(valid.mode, 'ollama');
  assert.equal(valid.summary, incident.summary);
  assert.deepEqual(valid.observations, ['ListBuckets by test-user at 2026-11-22T08:00:00Z']);
  assert.equal(prompt.model, 'qwen3:8b');
  assert.deepEqual(JSON.parse(prompt.prompt), incident.events);
  answer = { ...answer, observations: ['Invented observation'] };
  const invalid = await investigate(incident, env);
  assert.equal(invalid.mode, 'rule-based-fallback');
  assert.deepEqual(invalid.observations, valid.observations);
  assert.equal((await investigate(incident, { OLLAMA_URL: 'http://example.com' })).mode, 'rule-based-fallback');
});
