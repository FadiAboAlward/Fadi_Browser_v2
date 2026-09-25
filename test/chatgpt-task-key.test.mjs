import assert from 'node:assert/strict';
import test from 'node:test';
import { chatgptTaskKey } from '../src/chatgpt-task-key.mjs';

const headers = { 'x-openai-subject': 'account-a', 'x-openai-session': 'chat-a' };

test('Fadi and Goilot bind repeat calls to separate chat contexts', () => {
  for (const client of ['fadi-gpt', 'goilot-gpt']) {
    const key = chatgptTaskKey(headers, client);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(chatgptTaskKey({ ...headers }, client), key);
    assert.notEqual(chatgptTaskKey({ ...headers, 'x-openai-session': 'chat-b' }, client), key);
  }
  assert.notEqual(chatgptTaskKey(headers, 'fadi-gpt'), chatgptTaskKey(headers, 'goilot-gpt'));
});

test('missing or invalid ingress identity fails closed to transport binding', () => {
  assert.equal(chatgptTaskKey(headers, 'goilot-claude'), null);
  assert.equal(chatgptTaskKey({ 'x-openai-session': 'chat-a' }, 'fadi-gpt'), null);
  assert.equal(chatgptTaskKey({ ...headers, 'x-openai-session': ['chat-a'] }, 'fadi-gpt'), null);
  assert.equal(chatgptTaskKey({ ...headers, 'x-openai-subject': 'x'.repeat(1025) }, 'fadi-gpt'), null);
});
