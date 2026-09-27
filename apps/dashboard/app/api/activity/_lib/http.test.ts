import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '@jave/core';
import { ActivityHttpError, readJsonBody } from './http';

const URL_BASE = 'http://localhost:3000/api/activity/trivia/move';
const LIMIT = 64;
const schema = z.object({ choice: z.number().int() }).strict();

/** A body that arrives in chunks with no Content-Length (HTTP chunked transfer). */
function chunkedRequest(chunks: readonly Uint8Array[]): { request: Request; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[pulled];
      pulled += 1;
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  };
  return { request: new Request(URL_BASE, init), pulled: () => pulled };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('the body was accepted'),
    (error: unknown) => error,
  );
}

describe('readJsonBody', () => {
  it('parses a small JSON body; an empty body is an empty object', async () => {
    const request = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"choice":2}',
    });
    await expect(readJsonBody(request, schema, LIMIT)).resolves.toEqual({ choice: 2 });
    const empty = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    await expect(readJsonBody(empty, z.object({}).strict(), LIMIT)).resolves.toEqual({});
  });

  it('BREAK: a chunked body is cut off at the cap instead of being buffered whole', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(LIMIT / 2));
    const { request, pulled } = chunkedRequest(Array.from({ length: 1000 }, () => chunk));
    const error = await failure(readJsonBody(request, schema, LIMIT));
    expect(error).toBeInstanceOf(ActivityHttpError);
    expect(error).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    // Reading stopped right after the cap: a few chunks, never the thousand offered.
    expect(pulled()).toBeLessThan(10);
  });

  it('BREAK: a declared length above the cap is refused before reading', async () => {
    const request = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(LIMIT + 1) },
      body: '{"choice":1}',
    });
    expect(await failure(readJsonBody(request, schema, LIMIT))).toMatchObject({ status: 413 });
  });

  it('BREAK: invalid UTF-8, non-JSON, other media types and unknown fields are refused', async () => {
    const { request: badUtf8 } = chunkedRequest([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]);
    expect(await failure(readJsonBody(badUtf8, schema, LIMIT))).toMatchObject({
      status: 400,
      code: 'VALIDATION',
    });
    const notJson = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{choice:1}',
    });
    expect(await failure(readJsonBody(notJson, schema, LIMIT))).toMatchObject({ status: 400 });
    const form = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"choice":1}',
    });
    expect(await failure(readJsonBody(form, schema, LIMIT))).toMatchObject({ status: 415 });
    const extra = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"choice":1,"admin":true}',
    });
    expect(await failure(readJsonBody(extra, schema, LIMIT))).toBeInstanceOf(ValidationError);
  });
});
