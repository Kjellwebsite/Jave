import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIEmbedField,
  type APISelectMenuOption,
  type APIStringSelectComponent,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import type { ReplyPayload } from '../interactions/types';
import { BRAND, COLORS, GLYPH, LIMITS } from './theme';
import { clip } from './format';

export interface PanelOptions {
  title: string;
  description?: string;
  color?: number;
  fields?: APIEmbedField[];
  footer?: string;
  thumbnailUrl?: string;
  url?: string;
  timestamp?: Date;
  /** Small kicker line above the title, e.g. "JVLN PROFILE". */
  kicker?: string;
}

/** The standard JAVE embed. Titles are uppercase; footers carry the organization mark. */
export function panel(options: PanelOptions): APIEmbed {
  const embed: APIEmbed = {
    title: clip(options.title.toUpperCase(), LIMITS.embedTitle),
    color: options.color ?? COLORS.base,
    footer: {
      text: clip(options.footer ?? `${BRAND.organization} ${GLYPH.dot} ${BRAND.bot}`, 2048),
    },
  };
  if (options.kicker) embed.author = { name: options.kicker.toUpperCase() };
  if (options.description) embed.description = clip(options.description, LIMITS.embedDescription);
  if (options.fields?.length) {
    embed.fields = options.fields.slice(0, LIMITS.fields).map((f) => ({
      name: clip(f.name, LIMITS.fieldName),
      value: clip(f.value || GLYPH.unknown, LIMITS.fieldValue),
      inline: f.inline,
    }));
  }
  if (options.thumbnailUrl) embed.thumbnail = { url: options.thumbnailUrl };
  if (options.url) embed.url = options.url;
  if (options.timestamp) embed.timestamp = options.timestamp.toISOString();
  return embed;
}

export function field(name: string, value: string, inline = false): APIEmbedField {
  return { name: name.toUpperCase(), value, inline };
}

export function success(title: string, description?: string): APIEmbed {
  return panel({ title: `${GLYPH.verified} ${title}`, description, color: COLORS.success });
}

export function failure(title: string, description?: string): APIEmbed {
  return panel({ title: `${GLYPH.cross} ${title}`, description, color: COLORS.danger });
}

export function notice(title: string, description?: string): APIEmbed {
  return panel({ title, description, color: COLORS.info });
}

type ButtonStyleName = 'primary' | 'secondary' | 'success' | 'danger';
const STYLES: Record<
  ButtonStyleName,
  ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger
> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export function button(
  label: string,
  customId: string,
  style: ButtonStyleName = 'secondary',
  disabled = false,
): APIButtonComponent {
  return {
    type: ComponentType.Button,
    style: STYLES[style],
    label: clip(label.toUpperCase(), LIMITS.buttonLabel),
    custom_id: customId,
    disabled,
  };
}

export function linkButton(label: string, url: string): APIButtonComponent {
  return {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: clip(label.toUpperCase(), LIMITS.buttonLabel),
    url,
  };
}

export function row(
  ...components: APIComponentInMessageActionRow[]
): APIActionRowComponent<APIComponentInMessageActionRow> {
  return { type: ComponentType.ActionRow, components };
}

export function stringSelect(
  customId: string,
  placeholder: string,
  options: APISelectMenuOption[],
  config: { min?: number; max?: number } = {},
): APIStringSelectComponent {
  return {
    type: ComponentType.StringSelect,
    custom_id: customId,
    placeholder: clip(placeholder, 150),
    options: options.slice(0, LIMITS.selectOptions),
    min_values: config.min ?? 1,
    max_values: config.max ?? 1,
  };
}

export function ephemeral(embed: APIEmbed, components?: ReplyPayload['components']): ReplyPayload {
  return { embeds: [embed], components, ephemeral: true };
}
