import { parseCredentialEnvironmentExpression } from '../../src/provider/environment-source.js';

it.each([
  ['${API_KEY:-fallback}', 'API_KEY', 'fallback', ':-'],
  ['${API_KEY:=fallback}', 'API_KEY', 'fallback', ':='],
  ['${KEY:-}', 'KEY', '', ':-'],
  // Same parser as expansion: the default runs to the first `}` and may hold `{`.
  ['${KEY:-a{b}', 'KEY', 'a{b', ':-'],
])('recognizes one complete private environment default expression: %s', (input, variable, fallback, operator) => {
  expect(parseCredentialEnvironmentExpression(input)).toEqual({ variable, fallback, operator });
});

it.each(['${KEY}', 'env://KEY', '${KEY:-${OTHER}}', 'prefix${KEY:-fallback}', '${KEY:-fallback}suffix', '${KEY:-a}${OTHER:-b}', '${9KEY:-fallback}', '${KEY:-unfinished', 'literal'])('rejects unsupported credential expression syntax: %s', input => {
  expect(parseCredentialEnvironmentExpression(input)).toBeUndefined();
});
