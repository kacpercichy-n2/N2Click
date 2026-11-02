# L3 realtime contract

- Preserve private topic `chat:conv:<conversationId>` and message events `INSERT` / `UPDATE` with the current `realtime.broadcast_changes` envelope (`payload.record`).
- Pin AND unpin must advance `messages.edited_at` monotonically, even when body is unchanged. The client merges fetched pages and broadcasts by this revision; a pin update at the same revision is discarded. Preserve terminal deletion and monotonic edit stamping. UI may show `(edytowana)` after pinning with the shared revision; a dedicated revision column would avoid that in future.
- Read event on that topic: `read`, payload `{ conversationId, userId, lastReadAt }` (camelCase).
- `chat_overview()` must expose `context_type`, `context_id`, and members' `muted_until` alongside `last_read_at`. Task context is used to hide task discussions from the dock, including when kind remains `group`.
- `chat_open_task(p_task_id) -> uuid`, `chat_set_pin(p_message_id,p_pinned)`, `chat_set_follow(p_conversation_id,p_follow)` as SPEC.
- Edit writes `body`, server stamps `edited_at`; soft delete writes `deleted_at`. Attachment and mention fields only written at insert by this client.
