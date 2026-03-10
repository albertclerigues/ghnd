import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";

export type GHDRpcSchema = ElectrobunRPCSchema & {
  bun: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};
