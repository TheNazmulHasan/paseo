# Nazmul's mods — the top of the queue

This fork is a three-layer rebase queue:

1. an upstream Paseo release tag,
2. Riajul's queue (`riajul/main`, his decisions in [fork-decisions.md](fork-decisions.md)),
3. **this queue: one commit ("card") per mod of Nazmul's**, subject `mod(<area>): …`.

Updating = `git rebase riajul/main` once Riajul has synced the release. `rerere` is on, so a
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
test "$(grep -c contentForeground packages/app/src/styles/markdown-styles.ts)" -ge 10
scripts/nazmul-bundle-has.sh 'Content contrast'
```

## bold-weight

Chat markdown `strong` is semibold (600), not medium. Doc: myos/paseo/bold-weight.md

```bash
scripts/nazmul-bundle-has.sh 'strong:Object.assign({},[a-z]*,{fontWeight:[a-z]*\.fontWeight\.semibold})'
```

## chat-link-actions

Always-visible Copy link / Reveal in Finder / Copy path icons after every link and path in a reply; code blocks keep Copy visible. Doc: myos/paseo/chat-link-actions.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/assistant-file-links --bail=1
scripts/nazmul-bundle-has.sh 'copyLink:"Copy link"'
scripts/nazmul-bundle-has.sh --asar expandHomePath
```

## sidebar-recent-sort

Sidebar "Sort by: Recent" puts the latest activity on top: projects (upstream PR #4140 card), pinned chats and rows inside a project. Doc: myos/paseo/sidebar-recent-sort.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/hooks/sidebar-workspaces-view-model.test.ts src/stores/sidebar-view-store.test.ts src/hooks/use-sidebar-pins.test.ts --bail=1
scripts/nazmul-bundle-has.sh 'Sort by'
```

## explorer-row-actions

Every Files row shows Copy path and Reveal in Finder icons. Doc: myos/paseo/explorer-row-actions.md

```bash
scripts/nazmul-bundle-has.sh -- '-copy-path'
```

## status-ring-web

The native-only status-ring clock never reaches the web bundle (it crashed the app on 2026-09-05). Doc: myos/paseo/updating-the-fork.md → 2026-09-05

```bash
test -z "$(grep -rln 'status-ring/clock' packages/app/src | grep -v 'status-ring/index')"
scripts/nazmul-bundle-has.sh --absent useStatusRingRotation
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

Hyper+J walks recent places (workspaces and views). Doc: myos/paseo/workspace-switcher.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/workspace-switcher --bail=1
scripts/nazmul-bundle-has.sh 'Switch recent workspaces'
scripts/nazmul-bundle-has.sh paseo-workspace-switcher-mru
```

## arrange-desk

Arrange keys lay out a workspace's sessions; the sidebar has Pinned / Views / Desk / Shelf. Docs: myos/paseo/arrange.md, myos/paseo/desk.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/arrange src/desk src/components/sidebar/sidebar-projection.test.ts --bail=1
scripts/nazmul-bundle-has.sh workspace.arrange.grid
scripts/nazmul-bundle-has.sh 'Clear desk'
```

## views-keybindings-place-sidebars

Split views + Live view; ~/.paseo/keybindings.json applies live; each workspace and view remembers its sidebars. Docs: myos/paseo/views.md, keybindings-file.md, place-sidebars.md

```bash
npm test --workspace=@getpaseo/app -- --project unit src/boards src/keyboard/file-keybindings.test.ts src/stores/place-sidebars-store.test.ts --bail=1
npx vitest run packages/desktop/src/features/keybindings-file.test.ts --bail=1
scripts/nazmul-bundle-has.sh -F './boards/[boardId].tsx'
scripts/nazmul-bundle-has.sh -F 'startsWith("/boards/")'
scripts/nazmul-bundle-has.sh keybindings-changed
scripts/nazmul-bundle-has.sh paseo-place-sidebars
scripts/nazmul-bundle-has.sh --absent global-sidebars
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
