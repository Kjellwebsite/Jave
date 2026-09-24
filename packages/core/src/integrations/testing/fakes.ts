import { randomBytes } from 'node:crypto';
import type { OutboundRequestInit, OutboundResponse } from '../outbound.delivery';

/**
 * Test-only helpers for the integrations module (MOCK / DEVELOPMENT ONLY):
 * a deterministic encryption key and a recording fake `fetch`.
 */

export function testEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

export interface RecordedRequest {
  url: string;
  init: OutboundRequestInit;
}

export type FakeReply = number | Error;

/** Replies in order (the last reply repeats); records every request. */
export function fakeFetch(replies: FakeReply[]) {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const fetch = async (url: string, init: OutboundRequestInit): Promise<OutboundResponse> => {
    requests.push({ url, init });
    const reply = replies[Math.min(index, replies.length - 1)] ?? 200;
    index++;
    if (reply instanceof Error) throw reply;
    return { status: reply, body: null };
  };
  return { fetch, requests };
}

export function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}
