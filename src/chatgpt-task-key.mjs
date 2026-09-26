import { createHash } from 'node:crypto';

const CHATGPT_CLIENTS = new Set(['goilot-gpt', 'fadi-gpt']);

export function chatgptTaskKey(headers, preboundClientId) {
  if (!CHATGPT_CLIENTS.has(preboundClientId)) return null;
  const session = headers['x-openai-session'];
  const subject = headers['x-openai-subject'];
  if (typeof session !== 'string' || typeof subject !== 'string' || !session || !subject || session.length > 1024 || subject.length > 1024) return null;
  return createHash('sha256').update(`${preboundClientId.length}:${preboundClientId}${subject.length}:${subject}${session.length}:${session}`).digest('hex');
}
