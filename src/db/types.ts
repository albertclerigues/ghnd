declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ThreadId = Brand<string, "ThreadId">;
export type EventId = Brand<string, "EventId">;
export type PinId = Brand<number, "PinId">;
export type ActivityId = Brand<string, "ActivityId">;

export function threadId(raw: string): ThreadId {
  return raw as ThreadId;
}

export function eventId(raw: string): EventId {
  return raw as EventId;
}

export function pinId(raw: number): PinId {
  return raw as PinId;
}

export function activityId(raw: string): ActivityId {
  return raw as ActivityId;
}

export interface NotificationRow {
  thread_id: string;
  repository: string;
  subject_type: string;
  subject_title: string;
  subject_url: string | null;
  reason: string;
  unread: number;
  github_updated_at: string;
  github_last_read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationEventRow {
  notification_thread_id: string;
  event_id: string;
  event_type: string;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  event_timestamp: string;
  created_at: string;
}

export interface PinnedRow {
  id: number;
  notification_thread_id: string | null;
  subject_type: string;
  subject_title: string;
  subject_url: string;
  repository: string;
  group_name: string;
  sort_order: number;
  created_at: string;
}

export interface ActivityRow {
  event_id: string;
  event_type: string;
  repository: string;
  action: string;
  target_title: string;
  target_url: string | null;
  event_timestamp: string;
  created_at: string;
}

export interface SyncMetaRow {
  key: string;
  value: string;
  updated_at: string;
}
