import { describe, expect, it } from 'vitest';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { cleanMultiline, cleanSingleLine, openTicketSchema, recordMessageSchema } from './schemas';
import { assignedStatus, resumedStatus, unassignedStatus } from './state';
import {
  buildTimeline,
  describeEvent,
  escapeHtml,
  escapeMarkdown,
  escapeMarkdownLine,
  formatBytes,
  renderHtml,
  renderMarkdown,
  safeHttpUrl,
  type TranscriptModel,
} from './transcript';
import type { TicketEventView, TicketMessageView } from './views';

const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  "'><iframe src=javascript:alert(1)>",
  '</style><script>alert(document.cookie)</script>',
  '<a href="javascript:alert(1)">x</a>',
  '`${alert(1)}`',
  '<!-- --><base href="https://evil.example/">',
].join(' ');

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 12, minute));

function message(overrides: Partial<TicketMessageView> = {}): TicketMessageView {
  return {
    id: 'm',
    authorUserId: 'u',
    authorName: 'Ada',
    authorRole: 'requester',
    body: 'Hello',
    attachments: [],
    isInternal: false,
    createdAt: at(1),
    editedAt: null,
    deletedAt: null,
    originalBody: null,
    ...overrides,
  };
}

function event(overrides: Partial<TicketEventView> = {}): TicketEventView {
  return {
    id: 'e',
    type: 'created',
    actorName: 'Ada',
    data: { category: 'technical', priority: 'high' },
    createdAt: at(0),
    ...overrides,
  };
}

function hostileModel(): TranscriptModel {
  return {
    reference: '#0042',
    subject: `Subject ${XSS}`,
    category: 'technical',
    priority: 'urgent',
    status: 'closed',
    openedAt: at(0),
    closedAt: at(30),
    closeReason: `Reason ${XSS}`,
    opener: `Opener ${XSS}`,
    assignee: `Handler ${XSS}`,
    reopenCount: 1,
    generatedAt: at(31),
    includesInternal: true,
    sla: {
      dueAt: at(60),
      firstResponseAt: at(5),
      firstResponseMinutes: 5,
      breachedAt: null,
      state: 'met',
      overdue: false,
    },
    aiSummary: { text: `Summary ${XSS}`, generatedAt: at(20), label: 'AI-GENERATED' },
    messages: [
      message({
        authorName: `Name ${XSS}`,
        body: `Body ${XSS}\n# heading\n[click](javascript:alert(1))`,
        attachments: [
          { name: `file ${XSS}.png`, url: 'javascript:alert(1)', size: 10 },
          {
            name: 'log.txt',
            url: 'https://cdn.discordapp.com/a/"onmouseover="alert(1)<x>',
            size: 2048,
          },
        ],
      }),
      message({
        id: 'n',
        authorRole: 'handler',
        isInternal: true,
        body: `Internal ${XSS}`,
        createdAt: at(2),
        editedAt: at(3),
        originalBody: `Original ${XSS}`,
      }),
      message({ id: 'd', body: 'deleted text', createdAt: at(4), deletedAt: at(5) }),
    ],
    events: [
      event(),
      event({
        id: 'e2',
        type: 'closed',
        data: { reason: `Closing ${XSS}` },
        createdAt: at(30),
      }),
    ],
    truncated: true,
  };
}

/** Tags the HTML template itself emits. Anything else would be injected markup. */
const TEMPLATE_TAGS =
  /^<\/?(html|head|meta|title|style|body|div|header|h1|h2|p|dl|dt|dd|ol|ul|li|span|time|a|footer)[\s>]/;

describe('transcript escaping', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>\`=&`)).toBe(
      '&lt;a href&#61;&quot;x&quot; onclick&#61;&#39;y&#39;&gt;&#96;&#61;&amp;',
    );
  });

  it('BREAK: hostile content cannot inject markup into the HTML transcript', () => {
    const html = renderHtml(hostileModel());
    const tags = html.match(/<[^\s>]*/g) ?? [];
    for (const tag of tags) {
      if (tag === '<!doctype') continue;
      expect(`${tag} `).toMatch(TEMPLATE_TAGS);
    }
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img|<svg|<iframe|<base/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The hostile javascript: attachment renders as plain text, the https one as a safe link.
    expect(html).toContain('file ');
    expect(html).toContain(
      'href="https://cdn.discordapp.com/a/%22onmouseover&#61;%22alert(1)%3Cx%3E" rel="noopener noreferrer nofollow"',
    );
  });

  it('is self-contained, script-free and CSP-locked', () => {
    const html = renderHtml(hostileModel());
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toMatch(/<link|<script|src=/i);
    expect(html).toContain('AI-GENERATED SUMMARY');
    expect(html).toContain('INTERNAL NOTE');
    expect(html).toContain('Includes internal notes — staff only.');
  });

  it('BREAK: hostile content cannot form links, HTML or headings in Markdown', () => {
    const md = renderMarkdown(hostileModel());
    // Our own link syntax for validated attachment URLs is the only allowed destination.
    const withoutSafeLinks = md.replace(/\]\(<https?:\/\/[^\s<>]+>\)/g, '');
    const userLines = withoutSafeLinks.split('\n').filter((line) => line.includes('alert'));
    expect(userLines.length).toBeGreaterThan(5);
    for (const line of userLines) {
      expect(line).not.toMatch(/(^|[^\\])</);
      expect(line).not.toMatch(/(^|[^\\])\]\(/);
      expect(line).not.toMatch(/(^|[^\\])`/);
    }
    expect(md).not.toContain('](<javascript');
    expect(md).toContain('> \\# heading');
    expect(md).toContain('(<https://cdn.discordapp.com/a/%22onmouseover=%22alert(1)%3Cx%3E>)');
    expect(md).toContain('## AI-GENERATED SUMMARY');
  });

  it('escapes Markdown punctuation', () => {
    expect(escapeMarkdown('**bold** [x](y) <b> #h | ~s~ `c` &lt;')).toBe(
      '\\*\\*bold\\*\\* \\[x\\]\\(y\\) \\<b\\> #h \\| \\~s\\~ \\`c\\` \\&lt;',
    );
    expect(escapeMarkdownLine('# title')).toBe('\\# title');
    expect(escapeMarkdownLine('  - item')).toBe('  \\- item');
    expect(escapeMarkdownLine('12. item')).toBe('12\\. item');
    expect(escapeMarkdownLine('> quote')).toBe('\\> quote');
    expect(escapeMarkdownLine('plain - text')).toBe('plain - text');
  });

  it('accepts only http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(safeHttpUrl('HTTP://EXAMPLE.COM')).toBe('http://example.com/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});

describe('transcript rendering', () => {
  it('omits staff sections from the requester transcript', () => {
    const model: TranscriptModel = {
      ...hostileModel(),
      includesInternal: false,
      sla: null,
      aiSummary: null,
      messages: [message()],
    };
    for (const output of [renderHtml(model), renderMarkdown(model)]) {
      expect(output).not.toContain('AI-GENERATED');
      expect(output).not.toContain('SLA');
      expect(output).not.toContain('INTERNAL NOTE');
      expect(output).toContain('Requester transcript — internal notes excluded.');
    }
  });

  it('merges events and messages chronologically, events first on ties', () => {
    const timeline = buildTimeline({
      ...hostileModel(),
      messages: [message({ createdAt: at(0) }), message({ id: 'late', createdAt: at(9) })],
      events: [
        event({ createdAt: at(0) }),
        event({ id: 'mid', type: 'claimed', createdAt: at(5) }),
      ],
    });
    expect(timeline.map((e) => (e.kind === 'event' ? e.event.id : e.message.id))).toEqual([
      'e',
      'm',
      'mid',
      'late',
    ]);
  });

  it('describes every event type in plain language', () => {
    expect(describeEvent(event())).toBe('Opened · TECHNICAL · HIGH');
    expect(
      describeEvent(
        event({
          type: 'status_changed',
          data: { from: 'open', to: 'waiting', reason: 'Need logs' },
        }),
      ),
    ).toBe('Status OPEN → WAITING — Need logs');
    expect(
      describeEvent(event({ type: 'priority_changed', data: { from: 'low', to: 'urgent' } })),
    ).toBe('Priority LOW → URGENT');
    expect(describeEvent(event({ type: 'sla_breached', data: {} }))).toBe(
      'First-response target missed',
    );
    expect(describeEvent(event({ type: 'sla_breach_retracted', data: {} }))).toBe(
      'Missed-target record withdrawn — the first reply was on time',
    );
    expect(
      describeEvent(
        event({ type: 'transcript_accessed', data: { format: 'html', includeInternal: true } }),
      ),
    ).toBe('Transcript accessed (html, with internal notes)');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('input normalization', () => {
  it('strips control characters including NUL', () => {
    expect(cleanMultiline('a\u0000b\r\nc\u0007\t d  ')).toBe('ab\nc\t d');
    expect(cleanSingleLine('  a\n\n b\u0000\tc ')).toBe('a b c');
  });

  it('BREAK: rejects oversized and empty-after-cleaning input', () => {
    const base = { category: 'general', subject: 'Valid subject', body: 'Valid body' };
    expect(() => parseInput(openTicketSchema, { ...base, subject: 'x'.repeat(121) })).toThrow(
      ValidationError,
    );
    expect(() => parseInput(openTicketSchema, { ...base, body: 'x'.repeat(4001) })).toThrow(
      ValidationError,
    );
    expect(() => parseInput(openTicketSchema, { ...base, body: 'x'.repeat(5_000_000) })).toThrow(
      ValidationError,
    );
    expect(() =>
      parseInput(openTicketSchema, { ...base, subject: '\u0000\u0000\u0000\n  ' }),
    ).toThrow(ValidationError);
    expect(() => parseInput(openTicketSchema, { ...base, category: 'admin' })).toThrow(
      ValidationError,
    );
    expect(() => parseInput(openTicketSchema, { ...base, priority: 'critical' })).toThrow(
      ValidationError,
    );
    expect(
      parseInput(openTicketSchema, { ...base, subject: 'x'.repeat(120) }).subject,
    ).toHaveLength(120);
  });

  it('BREAK: rejects malformed message payloads from the gateway', () => {
    const base = {
      threadId: '400000000000000001',
      discordMessageId: '400000000000000002',
      author: { discordId: '400000000000000003', username: 'x' },
      body: 'hi',
    };
    expect(() => parseInput(recordMessageSchema, { ...base, threadId: '1 OR 1=1' })).toThrow(
      ValidationError,
    );
    expect(() =>
      parseInput(recordMessageSchema, {
        ...base,
        attachments: Array.from({ length: 11 }, () => ({
          name: 'a',
          url: 'https://a.example',
          size: 1,
        })),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(recordMessageSchema, {
        ...base,
        attachments: [{ name: 'a', url: 'https://a.example', size: -1 }],
      }),
    ).toThrow(ValidationError);
  });
});

describe('state machine helpers', () => {
  it('keeps waiting through assignment changes and resumes to the holder', () => {
    expect(assignedStatus({ status: 'open', assigneeUserId: null })).toBe('claimed');
    expect(assignedStatus({ status: 'waiting', assigneeUserId: null })).toBe('waiting');
    expect(unassignedStatus({ status: 'claimed', assigneeUserId: 'u' })).toBe('open');
    expect(unassignedStatus({ status: 'waiting', assigneeUserId: 'u' })).toBe('waiting');
    expect(resumedStatus({ status: 'waiting', assigneeUserId: 'u' })).toBe('claimed');
    expect(resumedStatus({ status: 'closed', assigneeUserId: null })).toBe('open');
  });
});
