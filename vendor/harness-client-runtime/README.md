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
the `slots` and `conversationEvents` members.

## Local divergence

`src/client/slots.ts` carries one deliberate edit against the verbatim copy:
the `SlotRegistry.register` definition face accepts `id`/`order` too, matching
what the deployed runtime's full registration contract actually validates for
list-kind slots (e.g. `conversation.input.dock`). The upstream snapshot's
trimmed face predates those fields; without them the canvas popup's dock
registration does not typecheck. Re-applying this edit is part of the sync
procedure.

## Sync procedure

Re-copy the six files from a newer harness checkout, update the pinned SHA in
this README and in the facade if the exported surface moved, then run
`pnpm build && pnpm test`. The npm-published harness releases lag master; this
snapshot is deliberately cut from source for that reason.
