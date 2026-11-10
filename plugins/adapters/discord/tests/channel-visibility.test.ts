import { describe, expect, it } from 'vitest';
import { ChannelFlagsBitField } from 'discord.js';
import { DISCORD_CHANNEL_FLAG_OBFUSCATED, isDiscordChannelObfuscated } from '../src/channel-visibility.js';

describe('discord channel obfuscation', () => {
  it('uses the documented CHANNEL_OBFUSCATED bit (1 << 17)', () => {
    expect(DISCORD_CHANNEL_FLAG_OBFUSCATED).toBe(131072);
  });

  it('detects the flag on raw numeric flags', () => {
    expect(isDiscordChannelObfuscated({ flags: 1 << 17 })).toBe(true);
    expect(isDiscordChannelObfuscated({ flags: (1 << 17) | (1 << 1) })).toBe(true);
    expect(isDiscordChannelObfuscated({ flags: 1 << 1 })).toBe(false);
    expect(isDiscordChannelObfuscated({ flags: 0 })).toBe(false);
  });

  it('detects the flag on bitfield-like objects and bigint', () => {
    expect(isDiscordChannelObfuscated({ flags: { bitfield: 1 << 17 } })).toBe(true);
    expect(isDiscordChannelObfuscated({ flags: { bitfield: 0 } })).toBe(false);
    expect(isDiscordChannelObfuscated({ flags: 1n << 17n })).toBe(true);
  });

  it('works with discord.js ChannelFlagsBitField even though its enum lacks the flag', () => {
    expect(isDiscordChannelObfuscated({ flags: new ChannelFlagsBitField(1 << 17) })).toBe(true);
    expect(isDiscordChannelObfuscated({ flags: new ChannelFlagsBitField(0) })).toBe(false);
  });

  it('does not rely on the obfuscated name', () => {
    expect(isDiscordChannelObfuscated({ flags: 0, name: '___hidden___' } as { flags: number })).toBe(false);
  });

  it('treats missing channel or flags as not obfuscated', () => {
    expect(isDiscordChannelObfuscated(undefined)).toBe(false);
    expect(isDiscordChannelObfuscated(null)).toBe(false);
    expect(isDiscordChannelObfuscated({})).toBe(false);
    expect(isDiscordChannelObfuscated({ flags: null })).toBe(false);
  });
});
