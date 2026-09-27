import { describe, expect, it } from 'vitest';
import { describeActivity, milestoneProgress, pipelineState, projectPath } from './project-view';

const base = { actor: null, people: {}, payload: {} };

describe('pipelineState', () => {
  it('marks passed, current and ahead stages', () => {
    expect(pipelineState('building', 'idea')).toBe('passed');
    expect(pipelineState('building', 'building')).toBe('current');
    expect(pipelineState('building', 'shipped')).toBe('ahead');
    expect(pipelineState('archived', 'idea')).toBe('ahead');
  });
});

describe('describeActivity', () => {
  it('describes status changes, restores and ships', () => {
    expect(
      describeActivity({
        ...base,
        type: 'project.status_changed',
        payload: { from: 'idea', to: 'building' },
      }),
    ).toMatchObject({ title: 'IDEA → BUILDING', tone: 'info' });
    expect(
      describeActivity({
        ...base,
        type: 'project.status_changed',
        payload: { from: 'testing', to: 'shipped' },
      }),
    ).toMatchObject({ tone: 'success' });
    expect(
      describeActivity({
        ...base,
        type: 'project.status_changed',
        payload: { from: 'archived', to: 'planning', unarchived: true },
      }).title,
    ).toBe('Restored to PLANNING');
  });

  it('names people only when core resolved them; hidden members stay anonymous', () => {
    expect(
      describeActivity({
        ...base,
        type: 'project.member_added',
        people: { memberId: { displayName: 'Jun Park' } },
        payload: { role: 'maintainer' },
      }).title,
    ).toBe('Jun Park joined as MAINTAINER');
    expect(
      describeActivity({
        ...base,
        type: 'project.member_removed',
        people: { memberId: null },
        payload: { self: true },
      }).title,
    ).toBe('A member left');
    expect(
      describeActivity({
        ...base,
        type: 'project.ownership_transferred',
        people: { from: { displayName: 'Mara' }, to: null },
      }).detail,
    ).toBe('Mara → A member');
  });

  it('describes details, links, milestones, repository and GitHub activity', () => {
    expect(
      describeActivity({
        ...base,
        type: 'project.updated',
        payload: { change: 'details', fields: ['title', 'summary'] },
      }),
    ).toMatchObject({ title: 'Details updated', detail: 'title, summary' });
    expect(
      describeActivity({
        ...base,
        type: 'project.updated',
        payload: { change: 'link_added', label: 'Docs' },
      }),
    ).toMatchObject({ title: 'Link added', detail: 'Docs' });
    expect(
      describeActivity({
        ...base,
        type: 'project.repo_linked',
        payload: { repo: null, previous: 'a/b' },
      }),
    ).toMatchObject({ title: 'GitHub repository unlinked', detail: 'a/b' });
    expect(
      describeActivity({
        ...base,
        type: 'project.github_push',
        payload: { commitCount: 1, headline: null },
      }),
    ).toMatchObject({ title: 'Pushed 1 commit', detail: null });
    expect(
      describeActivity({
        ...base,
        type: 'project.release_published',
        payload: { tag: 'v1.0.0', name: 'One' },
      }),
    ).toMatchObject({ title: 'Release v1.0.0', detail: 'One' });
  });

  it('BREAK: hostile payload values never become markup or crash the feed', () => {
    const line = describeActivity({
      ...base,
      type: 'project.status_changed',
      payload: { from: '<script>', to: { toString: 'x' } },
    });
    expect(line.title).toBe('UNKNOWN → UNKNOWN');
    expect(describeActivity({ ...base, type: 'something.new' }).title).toBe('something.new');
    expect(
      describeActivity({ ...base, type: 'project.github_push', payload: { commitCount: '9999' } })
        .title,
    ).toBe('Pushed 0 commits');
  });
});

describe('projectPath', () => {
  it('builds the canonical path and encodes anything unexpected', () => {
    expect(projectPath('rocket-engine')).toBe('/projects/rocket-engine');
    expect(projectPath('a/../b?x')).toBe('/projects/a%2F..%2Fb%3Fx');
  });
});

describe('milestoneProgress', () => {
  it('counts done milestones out of the ones still in scope', () => {
    expect(
      milestoneProgress([
        { status: 'done' },
        { status: 'active' },
        { status: 'planned' },
        { status: 'dropped' },
      ]),
    ).toEqual({ done: 1, total: 3 });
    expect(milestoneProgress([])).toEqual({ done: 0, total: 0 });
  });
});
