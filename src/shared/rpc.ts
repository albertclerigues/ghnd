import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";

// Row shapes for RPC responses (mirrors DB rows but explicitly typed for the boundary)
export interface NotificationWithEvents {
  threadId: string;
  repository: string;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string | null;
  reason: string;
  unread: boolean;
  githubUpdatedAt: string;
  events: NotificationEventData[];
}

export interface NotificationEventData {
  eventId: string;
  eventType: string;
  actor: string;
  body: string | null;
  summary: string | null;
  url: string | null;
  eventTimestamp: string;
}

export interface PinnedGroupData {
  groupName: string;
  items: PinnedItemData[];
}

export interface PinnedItemData {
  id: number;
  subjectType: string;
  subjectTitle: string;
  subjectUrl: string;
  repository: string;
  notificationThreadId: string | null;
}

export interface ActivityData {
  eventId: string;
  eventType: string;
  repository: string;
  action: string;
  targetTitle: string;
  targetUrl: string | null;
  eventTimestamp: string;
}

export type UpdatedScope = "notifications" | "pinned" | "activity";

export type GHDRpcSchema = ElectrobunRPCSchema & {
  bun: RPCSchema<{
    requests: {
      getNotifications: {
        params: undefined;
        response: NotificationWithEvents[];
      };
      getPinned: {
        params: undefined;
        response: PinnedGroupData[];
      };
      getActivity: {
        params: { limit?: number };
        response: ActivityData[];
      };
      markDone: {
        params: { threadId: string };
        response: undefined;
      };
      pinItem: {
        params: {
          subjectType: string;
          subjectTitle: string;
          subjectUrl: string;
          repository: string;
          groupName?: string;
          notificationThreadId?: string;
        };
        response: { id: number };
      };
      unpinItem: {
        params: { id: number };
        response: undefined;
      };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      stateUpdated: { scope: UpdatedScope };
    };
  }>;
};
