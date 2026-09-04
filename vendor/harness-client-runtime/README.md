# harness-client-runtime

Pinned snapshot of the DeepSeek Harness client-runtime contract, copied
verbatim from `deepseek-harness@` **a046ac5d35**
(`packages/client/runtime/src/client`) so this repo compiles and tests against
the same contract the deployed harness serves. At runtime nothing loads from
here: the browser bundle keeps `@deepseek-ai/dsh-client-runtime/client`
external and the deployed module table answers the require. Only types and the
specs' `ConversationNodeAssembler` value come from this snapshot.

Copied files:

```
src/client/contract/conversation.ts
src/client/conversation/event-registry.ts
src/client/conversation/definition-registry.ts
src/client/sessions/conversation-assembler.ts
src/client/sessions/conversation-location-index.ts
src/client/slots.ts
```

`src/client/index.ts` is a hand-written facade: it re-exports the surface the
plugin uses, aliases `ClientContext`, and augments the cordis `Context` with
the `slots`, `conversationEvents`, and `settingsScope` members.

## Hand-added extensions beyond the pinned snapshot

The pinned SHA above predates two members this plugin now needs, and
`packages/client/runtime` no longer exists at that path in current harness
source to re-copy from (its responsibilities moved into `dsh-client-ui-slots`
and `dsh-client-ui-settings`). Rather than a full re-sync, these were added by
hand, each trimmed to only what this plugin calls, matching the existing
file's style:

- `src/client/slots.ts` — a second `register` overload for chain-kind slots
  (`select` + a `matched` prop), needed for `conversation.chat.turnTail`.
- `src/client/settings.ts` — a new file: `SettingsScope`/`SettingsScopeBinder`
  reaching `ctx.settingsScope`, needed to read Harness's own Compact/Normal
  transcript-view preference (see `src/client/transcript-view.ts` in this
  package's `src/`, not vendor).

A future full re-sync (once a newer runtime snapshot source exists to copy
from) should fold these into whatever the upstream shape becomes rather than
keep them as permanent hand-written members.

## Sync procedure

Re-copy the six files from a newer harness checkout, update the pinned SHA in
this README and in the facade if the exported surface moved, then run
`pnpm build && pnpm test`. The npm-published harness releases lag master; this
snapshot is deliberately cut from source for that reason.
