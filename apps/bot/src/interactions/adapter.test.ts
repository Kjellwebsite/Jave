import { describe, expect, it } from 'vitest';
import { ComponentType, ModalSubmitFields } from 'discord.js';
import { modalFieldReader } from './adapter';

/** The fields discord.js builds for a submitted modal (its constructor is private in the typings). */
function submittedFields(
  components: readonly { customId: string; value: string }[],
): ModalSubmitFields {
  const labels = components.map((component, index) => ({
    type: ComponentType.Label,
    id: index * 2 + 1,
    component: { type: ComponentType.TextInput, id: index * 2 + 2, ...component },
  }));
  const fields: ModalSubmitFields = Reflect.construct(ModalSubmitFields, [labels]);
  return fields;
}

describe('modalFieldReader', () => {
  it('reads submitted text inputs', () => {
    const reader = modalFieldReader(submittedFields([{ customId: 'hours', value: '24' }]));
    expect(reader.text('hours')).toBe('24');
  });

  it('BREAK: a field the modal variant does not hold reads as blank, where discord.js throws', () => {
    const fields = submittedFields([{ customId: 'hours', value: '24' }]);
    expect(() => fields.getTextInputValue('team')).toThrow(/team/);
    const reader = modalFieldReader(fields);
    expect(reader.text('team')).toBe('');
    expect(reader.select('achievement')).toEqual([]);
    // A text input read as a select (or the reverse) is absent too, never a crash.
    expect(reader.select('hours')).toEqual([]);
  });

  it('reads nothing outside a modal', () => {
    const reader = modalFieldReader(null);
    expect(reader.text('hours')).toBe('');
    expect(reader.select('type')).toEqual([]);
  });
});
