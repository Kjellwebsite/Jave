import { describe, expect, it } from 'vitest';
import {
  eventCountLabel,
  groupEventTypes,
  PAYLOAD_PREVIEW_MAX_CHARS,
  payloadPreview,
  webhookEndpoint,
} from './integration-view';

describe('payloadPreview', () => {
  it('pretty-prints JSON and keeps hostile strings as plain text', () => {
    const preview = payloadPreview({ text: '<img src=x onerror=alert(1)>', n: 1 });
    expect(preview.truncated).toBe(false);
    expect(preview.text).toContain('"text": "<img src=x onerror=alert(1)>"');
    expect(preview.length).toBe(preview.text.length);
  });

  it('BREAK: a huge payload is capped for display, never rendered whole', () => {
    const preview = payloadPreview({ blob: 'x'.repeat(PAYLOAD_PREVIEW_MAX_CHARS * 3) });
    expect(preview.truncated).toBe(true);
    expect(preview.text).toHaveLength(PAYLOAD_PREVIEW_MAX_CHARS);
    expect(preview.length).toBeGreaterThan(PAYLOAD_PREVIEW_MAX_CHARS * 3);
  });

  it('BREAK: unprintable values do not crash the page', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(payloadPreview(cyclic).text).toBe('[unprintable payload]');
    expect(payloadPreview(undefined).text).toBe('null');
    expect(payloadPreview(10n).text).toBe('[unprintable payload]');
  });
});

describe('webhookEndpoint', () => {
  it('joins the public origin and the webhook path', () => {
    expect(webhookEndpoint('https://jave.example', '/api/webhooks/ci-hooks')).toBe(
      'https://jave.example/api/webhooks/ci-hooks',
    );
    expect(webhookEndpoint('https://jave.example/base/', '/api/webhooks/github')).toBe(
      'https://jave.example/api/webhooks/github',
    );
    expect(webhookEndpoint('not a url', '/api/webhooks/x')).toBe('/api/webhooks/x');
  });
});

describe('groupEventTypes', () => {
  it('groups by family in catalog order', () => {
    const groups = groupEventTypes([
      { type: 'project.created', description: 'a' },
      { type: 'member.joined', description: 'b' },
      { type: 'project.shipped', description: 'c' },
    ]);
    expect(groups.map((group) => group.family)).toEqual(['project', 'member']);
    expect(groups[0]!.events.map((event) => event.type)).toEqual([
      'project.created',
      'project.shipped',
    ]);
  });
});

describe('eventCountLabel', () => {
  it('pluralizes', () => {
    expect(eventCountLabel(1)).toBe('1 event');
    expect(eventCountLabel(3)).toBe('3 events');
  });
});
