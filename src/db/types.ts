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
  description_summary: string | null;
  description_body: string | null;
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
  body: string | null;
  event_timestamp: string;
  created_at: string;
}

export interface SyncMetaRow {
  key: string;
  value: string;
  updated_at: string;
}

// Event type discriminated union for type-safe event handling
export type NotificationEventType =
  | "comment"
  | "review"
  | "review_request"
  | "merge"
  | "close"
  | "reopen"
  | "label"
  | "assignment"
  | "rename"
  | "reference"
  | "commit";

// Input types for upsert operations (what goes INTO the DB)
export interface UpsertNotificationInput {
  threadId: ThreadId;
  repository: string;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  unread: boolean;
  githubUpdatedAt: string;
  githubLastReadAt: string | null;
}

export interface UpsertNotificationEventInput {
  notificationThreadId: ThreadId;
  eventId: EventId;
  eventType: NotificationEventType;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  eventTimestamp: string;
}

export interface UpsertActivityInput {
  eventId: ActivityId;
  eventType: string;
  repository: string;
  action: string;
  targetTitle: string;
  targetUrl: string | null;
  body: string | null;
  eventTimestamp: string;
}

// Action vocabulary for normalized activity events
export type ActivityAction =
  | "committed"
  | "commented"
  | "opened"
  | "closed"
  | "merged"
  | "reviewed"
  | "created"
  | "deleted"
  | "forked"
  | "starred"
  | "released";
