/** The capture page: completeness, escaping and layout constraints. */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renderCapture } = require('../dist/index.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${x}`)); };

const html = renderCapture({
  title: 'Create order',
  protocol: 'rest',
  subtitle: 'POST https://api.example.com/v1/orders?trace=1',
  chips: [{ label: '201 Created', tone: 'good' }, { label: '142 ms' }, { label: '284 bytes' }],
  capturedAt: '15 January 2026, 12:00',
  sections: [
    { label: 'Request headers', kind: 'kv', rows: [['Content-Type', 'application/json'], ['Authorization', '••••••••  (hidden)']] },
    { label: 'Request body (json)', kind: 'code', text: '{\n  "amount": 2500\n}' },
    { label: 'Response headers', kind: 'kv', rows: [['x-request-id', 'req_8fA2kQ']] },
    { label: 'Response body', kind: 'code', text: '{"orderId":"ord_1","state":"queued"}' },
    { label: 'Empty section', kind: 'kv', rows: [] },
    { label: 'Empty code', kind: 'code', text: '', emptyNote: 'No body' },
  ],
});

check('the title appears', html.includes('Create order'));
check('the subtitle carries method and URL', html.includes('POST https://api.example.com/v1/orders?trace=1'));
check('chips render with their tone', html.includes('chip good') && html.includes('201 Created'));
check('request headers included', html.includes('Content-Type') && html.includes('application/json'));
check('a redacted value stays redacted', html.includes('(hidden)') && !html.includes('Bearer '));
check('request body included', html.includes('&quot;amount&quot;: 2500'));
check('response body included', html.includes('ord_1'));
check('empty kv section says None', html.includes('None'));
check('empty code section uses its note', html.includes('No body'));
check('the timestamp is in the footer', html.includes('15 January 2026, 12:00'));

// Escaping: a response full of HTML must not become markup.
const nasty = renderCapture({
  title: '<img src=x onerror=alert(1)>',
  protocol: 'rest',
  subtitle: 'GET http://x/"><script>bad()</script>',
  chips: [{ label: '<b>200</b>' }],
  capturedAt: 'now',
  sections: [{ label: 'Response body', kind: 'code', text: '<script>alert("xss")</script>' }],
});
check('a script tag in the body is escaped', !nasty.includes('<script>alert'), 'raw script survived');
check('  ...and is still readable as text', nasty.includes('&lt;script&gt;alert'));
check('a tag in the title is escaped', !nasty.includes('<img src=x'));
check('a quote in the subtitle is escaped', nasty.includes('&quot;&gt;&lt;script&gt;'));

// Long unbroken values must be allowed to wrap or the image is unusably wide.
check('long values are told to wrap', html.includes('overflow-wrap: anywhere'));
check('the page has a fixed sensible width', /width:\s*1040px/.test(html));

// Self-contained: nothing may be fetched while rendering a screenshot.
check('no remote references', !/https?:\/\/(?!api\.example|x\/)/.test(html.replace(/xmlns="[^"]*"/g, '')));
check('no external stylesheet or script', !/<link |<script/.test(html));

console.log(`\nCapture render: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
