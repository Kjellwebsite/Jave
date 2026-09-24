import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../testing';
import { createEventHandlers, publishEvent, type EventSubscriber } from './bus';
import { DOMAIN_EVENT_TYPES } from './catalog';

describe('domain event bus', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('delivers events to matching subscribers only, isolating failures', async () => {
    const received: string[] = [];
    let failOnce = true;
    const subscribers: EventSubscriber[] = [
      {
        name: 'a',
        types: ['project.shipped'],
        handle: async (_c, e) => void received.push(`a:${e.type}`),
      },
      { name: 'b', types: '*', handle: async (_c, e) => void received.push(`b:${e.type}`) },
      {
        name: 'flaky',
        types: ['project.shipped'],
        handle: async () => {
          if (failOnce) {
            failOnce = false;
            throw new Error('transient');
          }
          received.push('flaky:ok');
        },
      },
    ];
    await publishEvent(kit.system, {
      type: 'project.shipped',
      aggregateType: 'project',
      aggregateId: 'p1',
    });
    await publishEvent(kit.system, {
      type: 'member.joined',
      aggregateType: 'member',
      aggregateId: 'm1',
    });
    const handlers = createEventHandlers(subscribers);
    await kit.drain(handlers);
    expect(received.sort()).toEqual(['a:project.shipped', 'b:member.joined', 'b:project.shipped']);
    kit.clock.advance(60_000);
    await kit.drain(handlers);
    expect(received).toContain('flaky:ok');
  });

  it('catalog event names follow <domain>.<verb>', () => {
    for (const type of DOMAIN_EVENT_TYPES) expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
});
