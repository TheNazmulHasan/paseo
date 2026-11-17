# Nazmul's mods — the top of the queue

This fork is a three-layer rebase queue:

1. an upstream Paseo release tag,
2. Riajul's queue (`riajul/main`, his decisions in [fork-decisions.md](fork-decisions.md)),
3. **this queue: one commit ("card") per mod of Nazmul's**, subject `mod(<area>): …`.

Updating = `git rebase --onto riajul/main <old base>` once Riajul has synced the release (he rewrites his queue). `rerere` is on, so a
conflict resolved once is replayed. Each section below is one card: its id, the policy in one
line, a pointer to the full doc in MyOS, and the commands that fail if the mod is gone. Run all:

```
node scripts/nazmul-verify.mjs            # needs npm run build:desktop first (bundle checks)
node scripts/nazmul-verify.mjs --source   # tests only, no build needed
```

A card that goes empty in a rebase means upstream or Riajul now does it: confirm the click path,
`git rebase --skip`, then delete its section here. Full procedure:
`/Users/nazmulhasan/DeepLearning/myos/paseo/updating-the-fork.md`.

## antigravity-provider

Antigravity CLI (agy) is a Paseo provider, with several Google accounts and Auto = most quota. Doc: myos/paseo/antigravity-provider.md

```bash
npx vitest run packages/server/src/server/agent/providers/antigravity/accounts.test.ts packages/server/src/server/agent/providers/antigravity/account-pool.test.ts packages/server/src/server/agent/providers/antigravity/agent.accounts.test.ts packages/server/src/server/agent/providers/antigravity/agy-probes.test.ts --bail=1
grep -q antigravity packages/server/src/server/agent/provider-registry.ts
scripts/nazmul-bundle-has.sh --asar -i antigravity
```

## reveal-folder-opens

Reveal in Finder on a folder opens the folder itself; files are still selected in their parent. Doc: myos/paseo/reveal-in-finder.md

```bash
grep -q 'Nazmul mod: a directory opens ITSELF' packages/app/src/components/file-explorer-pane.tsx
scripts/nazmul-bundle-has.sh 'filePath:[a-z]*?void 0'
```

## content-contrast

Settings → Appearance → Content contrast dims chat prose only (setting `contentTextTone`, token `contentForeground`). Doc: myos/paseo/content-contrast.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/appearance/apply.test.ts src/hooks/use-settings/storage.test.ts --bail=1
test "$(grep -c contentForeground packages/app/src/components/markdown/styles.ts)" -ge 4
scripts/nazmul-bundle-has.sh 'Content contrast'
```

## bold-weight

Chat markdown `strong` is semibold (600), not upstream's bold (700); desktop/web only, native renders any non-normal weight as bold. Doc: myos/paseo/bold-weight.md

```bash
grep -q 'strong: { fontWeight: "600"' packages/app/src/components/markdown/styles.ts
scripts/nazmul-bundle-has.sh 'strong:{fontWeight:"600"}'
```

## chat-link-actions

Always-visible Copy link / Reveal in Finder / Copy path icons after every link and path in a reply; code blocks keep Copy visible. Doc: myos/paseo/chat-link-actions.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/assistant-file-links --bail=1
scripts/nazmul-bundle-has.sh 'copyLink:"Copy link"'
grep -q AssistantLinkInlineActions packages/app/src/components/markdown/renderers.web.tsx
```

## sidebar-recent-sort

Sidebar "Sort projects: Recent" orders projects by latest activity (upstream PR #4140 card); "Recent activity" is a 4th option in upstream's own Sort (default), and also orders Pinned. Doc: myos/paseo/sidebar-recent-sort.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/hooks/sidebar-workspaces-view-model.test.ts src/stores/sidebar-view-store.test.ts src/hooks/use-sidebar-pins.test.ts --bail=1
scripts/nazmul-bundle-has.sh 'Sort projects'
scripts/nazmul-bundle-has.sh 'Recent activity'
```

## explorer-row-actions

Every Files row shows Copy path and Reveal in Finder icons. Doc: myos/paseo/explorer-row-actions.md

```bash
scripts/nazmul-bundle-has.sh -- '-copy-path'
```

## tab-switcher

Hyper+L / Ctrl+Tab: Arc-style recent tabs, tap = previous, hold to walk, release commits. Must-have. Doc: myos/paseo/tab-switcher.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/tab-switcher src/keyboard/availability.test.ts --bail=1
scripts/nazmul-bundle-has.sh 'Switch recent tabs'
```

## new-workspace-files

The New workspace (Cmd+N) screen shows the selected project's Files tree. Doc: myos/paseo/new-workspace-files.md

```bash
grep -q NewWorkspaceFilesSidebar packages/app/src/screens/new-workspace-screen.tsx
scripts/nazmul-bundle-has.sh new-workspace-files-sidebar
```

## attention-banner-sidebar

"Agent finished" banner sits above Add project in the left sidebar on desktop. Doc: myos/paseo/attention-banner-sidebar.md

```bash
scripts/nazmul-bundle-has.sh attention-banner-sidebar
```

## workspace-switcher

Hyper+J walks recent places (workspaces and views); background workspaces follow the sidebar's Show background switch (Desk members always show). Doc: myos/paseo/workspace-switcher.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/workspace-switcher --bail=1
scripts/nazmul-bundle-has.sh 'Switch recent workspaces'
scripts/nazmul-bundle-has.sh paseo-workspace-switcher-mru
```

## arrange-desk

Arrange keys lay out a workspace's sessions; the sidebar has two sections: Pinned (the views, then the pinned workspaces) and Folders (the built-in Desk folder first, then your folders). Docs: myos/paseo/arrange.md, myos/paseo/desk.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/arrange src/desk src/components/sidebar/sidebar-projection.test.ts --bail=1
scripts/nazmul-bundle-has.sh workspace.arrange.grid
scripts/nazmul-bundle-has.sh 'Clear desk'
```

## views-keybindings-place-sidebars

Split views (the Live view was removed 2026-11-17: no row, route or refresh; a stored Live board is dropped on load) (Desk select → Columns / Grid makes one, Add / Empty + add fills the active one); ~/.paseo/keybindings.json applies live; each workspace and view remembers its sidebars. Docs: myos/paseo/views.md, keybindings-file.md, place-sidebars.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/boards src/desk/target-view.test.ts src/keyboard/file-keybindings.test.ts src/stores/place-sidebars-store.test.ts --bail=1
npx vitest run packages/desktop/src/features/keybindings-file.test.ts --bail=1
! grep -rn 'from "@react-navigation/' packages/app/src
grep -q 'ensurePanelsRegistered()' packages/app/src/boards/board-screen.tsx
scripts/nazmul-bundle-has.sh -F './boards/[boardId].tsx'
scripts/nazmul-bundle-has.sh -F 'startsWith("/boards/")'
scripts/nazmul-bundle-has.sh sidebar-desk-select-replace-view
scripts/nazmul-bundle-has.sh keybindings-changed
scripts/nazmul-bundle-has.sh paseo-place-sidebars
scripts/nazmul-bundle-has.sh --absent global-sidebars
! grep -rn 'LIVE_BOARD_ID\|refreshLiveBoard\|useLiveBoardSync' packages/app/src --include='*.ts' --include='*.tsx' | grep -v test
scripts/nazmul-bundle-has.sh --absent board-refresh
scripts/nazmul-bundle-has.sh --absent sidebar-view-live-dot
```

## session-mentions

Typing @ in the composer lists sessions and inserts "Title (agent-id)". Doc: myos/paseo/session-mentions.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/utils/session-mention-autocomplete.test.ts --bail=1
grep -q session-mention-autocomplete packages/app/src/hooks/use-agent-autocomplete.ts
```

## topic-trail

Each agent session gets a "topic trail": its last 3 topics (newest first, click = scroll the chat to where the topic began) plus an amber "Your move" line while it waits on the user. A thin strip under every pane's tab row, also in the agent tab hover card. The daemon writes it after each turn through Antigravity (then Claude Haiku), never any other provider; `PASEO_TOPIC_TRAIL=0` turns it off. Doc: myos/paseo/topic-trail.md

```bash
npx vitest run packages/server/src/server/agent/topic-trail packages/protocol/src/topic-trail.test.ts --bail=1
npm test --workspace=@getpaseo/app -- --project unit src/components/topic-trail --bail=1
grep -q 'resolveTopicTrailProviders' packages/server/src/server/agent/topic-trail/topic-trail-service.ts
grep -q topic-trail-service packages/server/src/server/bootstrap.ts
grep -q TopicTrailStrip packages/app/src/components/split-container.tsx
scripts/nazmul-bundle-has.sh 'topic-trail-strip-'
```

## gateway-upstream

When the local CLIProxyAPI router (Nazmul's switchboard) serves a chat from its API-key credential (Riajul's pool), Paseo asks that upstream pool the same session/quota question, so the context popover names the real pool account (not `config:claude[<hash>]`) and "All accounts" lists the pool's accounts, each login once. Config `agents.cliproxyapi.upstream: {baseUrl, apiKey}`, read once at daemon start. Doc: myos/paseo/gateway-upstream.md

```bash
npx vitest run packages/server/src/server/agent/gateway/upstream.test.ts --bail=1
grep -q followUpstreamRoute packages/server/src/server/agent/gateway/session-route.ts
grep -q expandUpstreamAccounts packages/server/src/server/agent/gateway/quota.ts
grep -q setGatewayUpstream packages/server/src/server/bootstrap.ts
```

## model-menu

`agents.providers.<id>.modelMenu: {first, hide}` shapes one provider's model picker: ids matching `first` (glob `*`) lead in pattern order, ids matching `hide` stay resolvable (old chats keep their label) but are not offered. Used on base claude so the switchboard's account rows sit at the top and the router's GPT/old rows are hidden. Doc: myos/paseo/model-menu.md

```bash
npx vitest run packages/server/src/server/agent/model-menu.test.ts --bail=1
grep -q modelMenu packages/protocol/src/provider-config.ts
grep -q applyModelMenu packages/server/src/server/agent/provider-registry.ts
```

## folders

User-made one-level folders hold workspaces and saved views (`board:<id>` item keys). The daemon owns them (`<paseoHome>/projects/folders.json`), pushes the full state as the `folders_update` fork session event, and files a workspace an agent creates into the caller workspace's folder. Agents use `list_folders` / `create_folder` / `set_workspace_folder`; the CLI is `paseo folder`. App half: the sidebar is two sections, Pinned (views + pinned workspaces, one count, one fold, the new-view icon) and Folders (the built-in Desk folder first, with its grouping menu / select / clear icons, then every folder plus a built-in Unfiled, always-visible + / rename / delete icons, delete with Undo), a folder icon on every workspace and view row and a "Move to folder" row-menu page, the picker on `workspace.folder.move` (Cmd+Ctrl+M, Ctrl+Alt+M), a "Folder" Desk grouping, and new workspaces filed where I was. Doc: myos/paseo/folders.md

```bash
npx vitest run --config packages/server/vitest.config.ts packages/server/src/server/folders packages/server/src/server/session/workspace-provisioning/workspace-provisioning-folders.test.ts --bail=1
npx vitest run packages/protocol/src/messages.folders.test.ts packages/cli/src/commands/folder --bail=1
grep -q folders_update packages/protocol/src/messages.ts
grep -q inheritCallerFolder packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts
grep -q registerFolderTools packages/server/src/server/agent/tools/paseo-tools.ts
grep -q folderSession packages/server/src/server/session.ts
npm test --workspace=@getpaseo/app -- --project unit src/folders src/desk src/components/sidebar src/workspace-switcher src/keyboard src/boards src/i18n --bail=1
grep -q useFoldersSync packages/app/src/contexts/session-context.tsx
grep -q landNewWorkspaces packages/app/src/desk/use-desk-reconcile.ts
grep -q FoldersSectionHeader packages/app/src/desk/shelf-title.tsx
grep -q FoldersBody packages/app/src/components/sidebar/sidebar-status-list.tsx
grep -q FoldersBody packages/app/src/components/sidebar-workspace-list.tsx
grep -q PinnedSectionHeader packages/app/src/components/sidebar/sidebar-status-list.tsx
grep -q PinnedSectionHeader packages/app/src/components/sidebar-workspace-list.tsx
grep -q DeskFolder packages/app/src/folders/folders-section.tsx
grep -q WorkspaceFolderButton packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx
grep -q useFolderMenuPages packages/app/src/components/sidebar/sidebar-workspace-menu.tsx
grep -q workspace.folder.move packages/app/src/keyboard/keyboard-shortcuts.ts
scripts/nazmul-bundle-has.sh 'moveTo:"Move to folder"'
scripts/nazmul-bundle-has.sh 'paseo-folders'
scripts/nazmul-bundle-has.sh 'workspace.folder.move'
scripts/nazmul-bundle-has.sh 'sidebar-desk-grouping'
scripts/nazmul-bundle-has.sh 'sidebar-views-split'
```

## sidebar-tabs

Arc-style vertical session list: every workspace row (Pinned, Desk folder, folders, Unfiled) has an always-visible chevron that stacks that workspace's tabs under it (same order as the top tab bar: `deriveWorkspacePaneState` over each visible pane, Explorer pane left out; the tab's own icon and status signal; full title on one line; the tab on screen highlighted; click opens the workspace with that tab focused; no close button). A view row has the same chevron and lists one line per pane (`workspace name · active tab`; click focuses the pane). Open or folded is kept per workspace / view on this device (`paseo-sidebar-tabs`). The Cmd+1..9 numbering never counts these lines. Docs: myos/paseo/sidebar-tabs.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/sidebar-tabs src/screens/workspace src/components/sidebar src/boards --bail=1
grep -q SidebarTabsChevron packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx
grep -q WorkspaceTabLines packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx
grep -q ViewPaneLines packages/app/src/boards/boards-section.tsx
grep -q deriveWorkspacePaneState packages/app/src/sidebar-tabs/model.ts
scripts/nazmul-bundle-has.sh 'paseo-sidebar-tabs'
scripts/nazmul-bundle-has.sh 'sidebar-tabs-chevron-'
scripts/nazmul-bundle-has.sh 'sidebar-tab-line-'
scripts/nazmul-bundle-has.sh 'sidebar-pane-line-'
```

## chief

The tool layer of Chief, the personal-assistant agent (design: myos/paseo/home-map.md). Four MCP tools: `session_states` (every open session as needs_you / working / your_move / parked from one pure `deriveSessionState`, with workspace, project, folder, flags, last activity, the topic trail's "Your move" line and a link; filters state, workspaceId, folder, staleDays, limit), `search_sessions` (text of user and agent messages across every session, archived included, read from the provider's own transcript with SpecStory as fallback; a workspace is private when its id is in `<paseoHome>/chief.json` `privateWorkspaceIds`, it is titled Debrief, or its cwd is in a `.local-only` folder or a folder named `(local-only)`; private workspaces return no text unless `chief.json` sets `searchPrivateText`), `app_command` (the daemon pushes the `app_command` fork session event; the app opens a workspace/tab, opens a view, or runs a keyboard action through the keyboard's own router or a Command Center item, and answers with `app_command.result.request`) and `list_app_actions` (asked of the live app). CLI: `paseo chief states` and `paseo chief search <query>` over the `chief.query` RPC. Doc: myos/paseo/home-map.md

```bash
npx vitest run --config packages/server/vitest.config.ts packages/server/src/server/chief --bail=1
npx vitest run packages/cli/src/commands/chief --bail=1
npm test --workspace=@getpaseo/app -- --project unit src/chief src/keyboard --bail=1
grep -q app_command packages/protocol/src/messages.ts
grep -q registerChiefTools packages/server/src/server/agent/tools/paseo-tools.ts
grep -q dispatchChiefMessage packages/server/src/server/session.ts
grep -q 'app_command: "workspace.manage"' packages/server/src/server/authorization/operation-permissions.ts
grep -q session_states packages/protocol/src/paseo-tool-presentation/catalog.ts
grep -q appCommandBus.bind packages/server/src/server/bootstrap.ts
grep -q useChiefCommands packages/app/src/contexts/session-context.tsx
grep -q registerShortcutRunner packages/app/src/hooks/use-keyboard-shortcuts.ts
grep -q ChiefHost packages/app/src/app/_layout.tsx
grep -q createChiefCommand packages/cli/src/cli.ts
scripts/nazmul-bundle-has.sh 'app_command'
scripts/nazmul-bundle-has.sh 'Call list_app_actions for the ids that exist'
scripts/nazmul-bundle-has.sh 'open_workspace needs args.workspaceId'
```

## home-map

Home, the screen Paseo opens on: what needs me, and where is everything (design: myos/paseo/home-map.md, part 3). Route `/home`. Top to bottom: Needs you, Your move (each with its one-line "Your move" text) and Working bands, then the map Folder -> workspace -> session (Desk folder first, my folders in order, Unfiled last; every level folds, fold state kept in `paseo-home-map`, an always-visible Unfold all / Fold all and Show quiet button; open loops only by default; each node has a state dot, counts "2 need you · 3 your move · 5 open" and the last-activity age; a click opens the session like a sidebar tab line), and a Chief box docked at the bottom (finds the agent labelled `paseo.role=chief`, sends a prompt, shows the latest reply as markdown; no Chief agent shows a "Set up Chief" hint, Home never creates one). The state rule is the one function `deriveSessionState` in `packages/protocol/src/session-state.ts`, imported by the server's `session_states` and by Home. Reached from a Home row at the top of the sidebar nav block, the Command Center item "Open Home" (`command:open-home`) and the keyboard action `home.open` (no default key). A desktop cold start lands on Home unless Settings > General > "Open Home on launch" is off. Doc: myos/paseo/home-map.md

```bash
npx vitest run packages/protocol/src/session-state.test.ts packages/protocol/src/chief.test.ts --bail=1
npx vitest run --config packages/server/vitest.config.ts packages/server/src/server/chief --bail=1
npm test --workspace=@getpaseo/app -- --project unit src/home-map src/keyboard src/navigation src/i18n src/hooks/use-settings --bail=1
grep -q "@getpaseo/protocol/session-state" packages/app/src/home-map/model.ts
grep -q "@getpaseo/protocol/session-state" packages/server/src/server/chief/session-rows.ts
grep -q hasChiefRoleLabel packages/app/src/home-map/model.ts
grep -q buildHomeRoute packages/app/src/navigation/host-runtime-bootstrap.ts
grep -q useHomeLaunchDecision packages/app/src/app/index.tsx
grep -q SidebarHomeRow packages/app/src/components/sidebar/sidebar-nav-rows.tsx
grep -q HomeMapHost packages/app/src/app/_layout.tsx
grep -q 'name="home"' packages/app/src/app/_layout.tsx
grep -q '"home.open"' packages/app/src/keyboard/keyboard-shortcuts.ts
grep -q '"home.open"' packages/app/src/keyboard/route-shortcut.ts
grep -q openHomeOnLaunch packages/app/src/hooks/use-settings/storage.ts
grep -q OpenHomeSection packages/app/src/screens/settings-screen.tsx
scripts/nazmul-bundle-has.sh 'paseo-home-map'
scripts/nazmul-bundle-has.sh 'home-band-needs-you'
scripts/nazmul-bundle-has.sh 'home-chief-send'
scripts/nazmul-bundle-has.sh 'Open Home on launch'
scripts/nazmul-bundle-has.sh 'sidebar-home'
```
