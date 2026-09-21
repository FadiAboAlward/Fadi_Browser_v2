import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1))), '..');
const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'buffer', windowsHide: true });
const files = listed.status === 0
  ? listed.stdout.toString('utf8').split('\0').filter(Boolean)
  : walk(root).map(file => path.relative(root, file));
const patterns = [
  { name: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'assigned-secret', regex: /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9_./+~-]{20,}["']/i }
];
const findings = [];
for (const file of files) {
  if (/package-lock\.json$|\.(?:png|jpg|jpeg|gif|zip|sqlite)$/i.test(file)) continue;
  let text;
  try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) findings.push({ file, line: index + 1, rule: pattern.name });
    }
  });
}
const result = { passed: findings.length === 0, scanned_files: files.length, findings };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (findings.length) process.exitCode = 1;

function walk(directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.git', 'node_modules', 'runtime', '.runtime'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
