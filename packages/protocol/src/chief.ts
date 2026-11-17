import { z } from "zod";

/**
 * Nazmul mod (chief): the wire shapes that let an agent drive the desktop app the way the user's
 * hands do. The daemon pushes `app_command` (a fork session event); the app does the work and
 * answers with `app_command.result.request`, so the agent learns whether it worked.
 */

/**
 * What the app is asked to do.
 * - `open_workspace` {serverId?, workspaceId, tabId?, agentId?}: like a sidebar click.
 * - `open_view` {viewId | name}: open a saved view (board).
 * - `run_action` {actionId, args?}: any keyboard action or Command Center item.
 * - `list_actions`: answer with every runnable action id and its label.
 */
export const APP_COMMAND_ACTIONS = [
  "open_workspace",
  "open_view",
  "run_action",
  "list_actions",
] as const;
export const AppCommandActionSchema = z.enum(APP_COMMAND_ACTIONS);
export type AppCommandAction = z.infer<typeof AppCommandActionSchema>;

export const AppCommandSchema = z.object({
  id: z.string(),
  action: AppCommandActionSchema,
  args: z.record(z.string(), z.unknown()).default({}),
});
export type AppCommand = z.infer<typeof AppCommandSchema>;

/** Daemon to app. Delivered only to clients subscribed to it (see FORK_SESSION_EVENTS). */
export const AppCommandMessageSchema = z.object({
  type: z.literal("app_command"),
  payload: AppCommandSchema,
});

/** One runnable thing, as `list_app_actions` reports it. */
export const AppActionInfoSchema = z.object({
  /** `keyboard:<action>` or `command:<contribution id>`; pass it to run_action as-is. */
  id: z.string(),
  kind: z.enum(["keyboard", "command"]),
  label: z.string(),
  /** Keyboard actions that need `args` (a tab number, a direction...) say so here. */
  args: z.string().optional(),
});
export type AppActionInfo = z.infer<typeof AppActionInfoSchema>;

/** App to daemon. Fire and forget: the daemon matches it to the waiting tool call by `commandId`. */
export const AppCommandResultRequestSchema = z.object({
  type: z.literal("app_command.result.request"),
  commandId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable().optional(),
  /** Only `list_actions` returns data. */
  data: z.object({ actions: z.array(AppActionInfoSchema) }).optional(),
});
export type AppCommandResultRequest = z.infer<typeof AppCommandResultRequestSchema>;

/**
 * The read side for `paseo chief`: the CLI asks the daemon for the same rows the MCP tools return.
 * `states` is `session_states`, `search` is `search_sessions`; `input` is that tool's input.
 */
export const ChiefQueryRequestSchema = z.object({
  type: z.literal("chief.query.request"),
  requestId: z.string(),
  query: z.enum(["states", "search"]),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const ChiefQueryResponseSchema = z.object({
  type: z.literal("chief.query.response"),
  payload: z.object({
    requestId: z.string(),
    result: z.unknown().nullable(),
    error: z.string().nullable(),
  }),
});
