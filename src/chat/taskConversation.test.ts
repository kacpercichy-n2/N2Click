import { describe, expect, it, vi } from 'vitest';
import { applyReadReceipt, isTaskConversation, mergeMessages, seenByMessage } from './chatState';
import { deleteMessage, editMessage, openTaskConversation, parseAttachments, sendMessage, setFollow, setPin, toChatConversation, toChatMessage, toChatReadEvent, type ChatDb } from './chatData';
const row = { id: 'm', conversation_id: 'c', author_id: 'a', body: 'Hi', created_at: '2026-11-02T10:00:00Z' };
const image = { path: 'c/a.png', mime: 'image/png', width: 10, height: 20, size: 50, name: 'test.png' };
const message = toChatMessage(row)!;
const conversation = toChatConversation({ id: 'c', kind: 'group', context_type: 'task', context_id: 't', members: [{ user_id: 'a', last_read_at: null }, { user_id: 'b', last_read_at: null, muted_until: 'infinity' }] })!;
const db = (partial: Partial<ChatDb>) => partial as ChatDb;

describe('task conversation data contract', () => {
  it('maps task context, follows, mentions, pins and attachments', () => {
    expect(isTaskConversation(conversation)).toBe(true);
    expect(conversation.members[1].mutedUntil).toBe('infinity');
    expect(toChatConversation({ id: 't', kind: 'task' })?.kind).toBe('task');
    expect(toChatMessage({ ...row, attachments: [image], mention_ids: ['b', 1], pinned_at: row.created_at, pinned_by: 'a', reply_to: 'original' })).toMatchObject({ attachments: [image], mentionIds: ['b'], pinnedAt: row.created_at, pinnedBy: 'a', replyTo: 'original' });
  });
  it('rejects invalid attachment shapes and foreign conversation paths', () => {
    expect(parseAttachments([image, { ...image, path: 'foreign/a.png' }, { ...image, width: -1 }, { ...image, mime: 'text/html' }, null], 'c')).toEqual([image]);
    expect(parseAttachments('garbage', 'c')).toEqual([]);
  });
  it('allows image-only messages and sends reply and deduplicated mentions', async () => {
    const insertMessage = vi.fn(async patch => ({ row: { ...row, ...patch }, error: null }));
    const result = await sendMessage(db({ insertMessage }), 'c', 'a', '', 'original', { attachments: [image as never], mentionIds: ['b', 'b'] });
    expect(result.ok).toBe(true);
    expect(insertMessage).toHaveBeenCalledWith(expect.objectContaining({ attachments: [image], mention_ids: ['b'], reply_to: 'original', body: '' }));
    expect((await sendMessage(db({ insertMessage }), 'c', 'a', '')).ok).toBe(false);
  });
  it('opens tasks with the atomic RPC adapter and reports failures', async () => {
    const openTaskAtomic = vi.fn(async () => ({ id: 'c', error: null }));
    expect(await openTaskConversation(db({ openTaskAtomic }), 't')).toEqual({ ok: true, value: 'c' });
    expect(openTaskAtomic).toHaveBeenCalledWith('t');
    expect((await openTaskConversation(db({}), 't')).ok).toBe(false);
  });
  it('edits and deletes through the author-filtered boundary', async () => {
    const updateMessage = vi.fn(async (_id, _author, patch) => ({ row: { ...row, ...patch }, error: null }));
    expect((await editMessage(db({ updateMessage }), 'm', 'a', '  new  ')).ok).toBe(true);
    expect(updateMessage).toHaveBeenCalledWith('m', 'a', { body: 'new' });
    expect((await editMessage(db({ updateMessage }), 'm', 'a', ' ')).ok).toBe(false);
    expect((await editMessage(db({ updateMessage }), 'm', 'a', 'x'.repeat(4001))).ok).toBe(false);
    expect((await deleteMessage(db({ updateMessage }), 'm', 'a')).ok).toBe(true);
    expect(updateMessage).toHaveBeenLastCalledWith('m', 'a', expect.objectContaining({ deleted_at: expect.any(String) }));
  });
  it('pin and follow pass explicit desired state, preserving server errors', async () => {
    const setPinDb = vi.fn(async () => ({ error: null }));
    const setFollowDb = vi.fn(async () => ({ error: { code: '42501', message: 'denied' } }));
    expect((await setPin(db({ setPin: setPinDb }), 'm', false)).ok).toBe(true);
    expect(setPinDb).toHaveBeenCalledWith('m', false);
    expect((await setFollow(db({ setFollow: setFollowDb }), 'c', false)).ok).toBe(false);
    expect(setFollowDb).toHaveBeenCalledWith('c', false);
  });
});

describe('read receipts and pin revisions', () => {
  it('parses read broadcasts, rejects invalid dates, ignores older watermarks', () => {
    const event = { conversationId: 'c', userId: 'b', lastReadAt: '2026-11-02T10:01:00Z' };
    expect(toChatReadEvent({ payload: event })).toEqual(event);
    expect(toChatReadEvent({ ...event, lastReadAt: 'bad' })).toBeNull();
    const updated = applyReadReceipt([conversation], event);
    expect(updated[0].members[1].lastReadAt).toBe(event.lastReadAt);
    expect(applyReadReceipt(updated, { ...event, lastReadAt: row.created_at })).toEqual(updated);
  });
  it('places each reader under their newest eligible message, excluding self', () => {
    const later = { ...message, id: 'later', createdAt: '2026-11-02T10:05:00Z' };
    const members = [{ userId: 'a', role: 'member' as const, lastReadAt: later.createdAt }, { userId: 'b', role: 'member' as const, lastReadAt: message.createdAt }, { userId: 'c', role: 'member' as const, lastReadAt: later.createdAt }];
    const result = seenByMessage([message, later], members, 'a');
    expect(result.m.map(m => m.userId)).toEqual(['b']);
    expect(result.later.map(m => m.userId)).toEqual(['c']);
  });
  it('accepts pin and unpin updates with newer authoritative revisions', () => {
    const pinned = { ...message, pinnedAt: '2026-11-02T10:01:00Z', pinnedBy: 'b', editedAt: '2026-11-02T10:01:00Z' };
    const unpinned = { ...pinned, pinnedAt: null, pinnedBy: null, editedAt: '2026-11-02T10:02:00Z' };
    expect(mergeMessages([message], [pinned])[0]).toEqual(pinned);
    expect(mergeMessages([pinned], [unpinned])[0]).toEqual(unpinned);
    expect(mergeMessages([unpinned], [pinned])[0]).toEqual(unpinned);
  });
});
