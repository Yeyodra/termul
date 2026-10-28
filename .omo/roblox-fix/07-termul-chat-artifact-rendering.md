# 07 - Termul chat artifact rendering: every place a generated artifact could be shown

**Scope.** Read-only map of the Termul renderer (`C:\Users\Novella\Documents\Github\termul`, branch
`dev`) covering every surface inside an agent chat session where a *generated artifact* - a clothing
atlas today, a 3D/object asset later - could be displayed. The goal is to locate a mount point for a
new **global viewport component** that is not clothing-specific.

**Method.** Static read of the working tree. Nothing was built, nothing was run, no source file was
modified. Every citation is `path:line` and every excerpt is transcribed from the file at that
line. Line numbers are 1-based.

**Quotation fidelity.** Excerpts are byte-accurate in code (identifiers, string literals, operators,
JSX/TS syntax). Non-ASCII punctuation inside source *comments* (em dashes, typographic
ellipses, arrows) is transliterated to ASCII here for portability, because the source uses
UTF-8 glyphs that do not survive every terminal and diff view. Where a comment's exact glyph
matters, read the cited file.

**Headline.** There is **no** artifact renderer in the chat today. A generated garment reaches the
UI only as (a) a generic MCP `image` content block rendered by `MediaBlocks` as a 96px thumbnail in
an attachment grid, and (b) a JSON blob in the `get_clothing_task` tool result that the renderer
never sees. The one piece of infrastructure that already solves "global overlay that survives tab
switches" is `CanvasMountLayer`, mounted once per renderer root from `WorkspaceLayout`. The
recommended mount point is a sibling of that layer, fed by a new artifact store - not a slot inside
`AgentChatPanel`.

---

## 1. The chat transcript component

### 1.1 Component tree, session pane down to one message

```
WorkspaceLayout (layouts/WorkspaceLayout.tsx)
|-- ShellFrame / MobileWorkspaceShell
    |-- WorkspaceMain  ->  PaneContent (components/workspace/PaneContent.tsx)
        |-- <AgentChatPanel sessionId isVisible />        PaneContent.tsx:572
            |-- PlanPanel                                 AgentChatPanel.tsx:912
            |-- div.relative.flex.min-h-0.flex-1.flex-col AgentChatPanel.tsx:918
            |   |-- SkillFilesProvider                    AgentChatPanel.tsx:919
            |   |   |-- <ChatMessageList items={timeline} .../>  AgentChatPanel.tsx:920
            |   |       |-- MessageScrollerProvider autoScroll  ChatMessageList.tsx:373
            |   |           |-- MessageScroller
            |   |               |-- MessageScrollerViewport      ChatMessageList.tsx:376
            |   |                   |-- VirtualizedTimeline      ChatMessageList.tsx:99
            |   |                       |-- renderItemContent    ChatMessageList.tsx:181
            |   |                           |-- TurnActivity     ChatMessageList.tsx:184
            |   |                           |-- ToolCallCard     ChatMessageList.tsx:201
            |   |                           |-- ThoughtGroup     ChatMessageList.tsx:213
            |   |                           |-- AgentSwitchSeparator  ChatMessageList.tsx:236
            |   |                           |-- ChatMessage      ChatMessageList.tsx:239
            |   |-- SubagentPill (absolute, top-right)     AgentChatPanel.tsx:932
            |-- ChatChangedFilesPanel                      AgentChatPanel.tsx:1019
            |-- ChatInputBar (+ ChatContextStrip)          AgentChatPanel.tsx:1027
```

The pane body is a `@container` root, which matters for any layout work done inside it:

`src/renderer/components/chat/AgentChatPanel.tsx:818`
```tsx
className="@container flex h-full flex-col bg-terminal-bg"
```

`PaneContent` mounts one `AgentChatPanel` per `agent-chat` tab, and every non-active tab stays
mounted but invisible (`INACTIVE_TAB_PANE_CLASS`). The visibility flag is what gates the panel's
store subscriptions:

`src/renderer/components/workspace/PaneContent.tsx:572`
```tsx
<AgentChatPanel sessionId={tab.sessionId} isVisible={isVisible} />
```

`src/renderer/components/chat/AgentChatPanel.tsx:132-133`
```tsx
const messages = useAcpStoreVisible((s) => s.messages[sessionId] ?? EMPTY_MESSAGES, isVisible)
const toolCalls = useAcpStoreVisible((s) => s.toolCalls[sessionId] ?? EMPTY_TOOL_CALLS, isVisible)
```

### 1.2 Where the timeline is built

The panel does **not** render messages directly. It flattens messages + tool calls + agent-switch
markers into a single seq-ordered `TimelineItem[]`, then groups it into turn activities:

`src/renderer/components/chat/AgentChatPanel.tsx:661-662`
```tsx
const timeline = useMemo(() => {
  const items = consolidateThoughtGroups(buildTimeline(messages, toolCalls, agentSwitches))
```

`buildTimeline` (`chat-timeline.ts:67`) and `groupTurnActivity` (`chat-timeline.ts:287`) are pure
functions with no React or store dependency. The timeline item union is the natural extension point
for a new artifact row:

`src/renderer/components/chat/chat-timeline.ts:7-25`
```ts
export type TimelineItem =
  | {
      kind: 'message'
      key: string
      message: ChatMessage
      /** True when this visible reply ends its turn. */
      isTurnTail?: boolean
      /** All agent narration in the turn, used by the turn-level copy action. */
      turnText?: string
    }
  | { kind: 'tool'; key: string; tool: ToolCall }
  | { kind: 'thought-group'; key: string; messages: ChatMessage[] }
  /** CAP-2 (spec-in-chat-agent-switch): durable agent-switch marker. */
  | { kind: 'switch'; key: string; switch: AgentSwitchRecord }
  /**
   * Worktree-creation progress row: a session-lifetime record of the launch
   * `git worktree add` op. `AgentChatPanel` splices it into the render-time
   * timeline right after the first user message (index 0 when none exists).
   * Never persisted, but kept rendering for the session's lifetime.
   */
  | { kind: 'worktree'; key: string; progressId: string }
  /** In-memory divider after Reload this chat. Not persisted. */
  | { kind: 'reload'; key: string }
```

The `worktree` variant is the precedent to copy: `AgentChatPanel` splices a non-persisted,
session-lifetime row into the timeline by hand (`AgentChatPanel.tsx:669-679`), and
`WorktreeCreationCard` renders it from a small dedicated store
(`stores/worktree-progress-store.ts`). A `kind: 'artifact'` row would work the same way.

### 1.3 Which file owns tool-call rendering

**`src/renderer/components/chat/ToolCallCard.tsx`** owns it, and it is the only file that renders a
tool call's structured result. It exports two renderers:

- `renderContentItem` (`ToolCallCard.tsx:135`) - one `ToolCallContent` item (diff / content / terminal)
- `ToolCallCard` (`ToolCallCard.tsx:490`) - the whole collapsible row

`ToolCallCard.tsx:135-140`
```tsx
/** Render one `ToolCallContent` item; shared with `SubagentDetailsDialog`. */
export function renderContentItem(
  item: ToolCallContent,
  key: number,
  language?: string,
  stream?: { terminalOutput?: string; terminalExitCode?: number | null }
): React.JSX.Element | null {
```

`ToolCallCard` is memoized and collapsed by default, which is the single most important constraint
for a viewport: a tool card is a *row*, not a stage.

`ToolCallCard.tsx:265-268`
```tsx
  // Collapsed by default for a clean, scannable list; a click reveals details.
  // Settle time is stamped only on an observed transition, so history-loaded
  // cards never show a bogus duration.
  const [open, setOpen] = useState(false)
```

---

## 2. Tool result rendering, and the existing image renderer

### 2.1 How a tool result renders today

`ToolCallCard` renders structured content when it exists and falls back to a text extraction of
`rawOutput` otherwise:

`ToolCallCard.tsx:252-263`
```tsx
  // Show the readable RESULT only - never the raw input or the JSON envelope.
  // Structured content (diffs/text) is canonical; otherwise extract the output.
  const resultText = hasContent ? '' : readableOutput(toolCall.rawOutput)
  const status = toolCall.status
  const failed = status === 'failed'
  const isSubagent = isSubagentCall(toolCall)
  // Diffs render as inline blocks. Anything else the call carries (text,
  // terminal output) stays behind the collapsible row.
  const inlineDiff = hasDiff && !isSubagent
  const detailItems = inlineDiff ? content.filter((item) => item.type !== 'diff') : content
  const hasDetail =
    detailItems.length > 0 || (!inlineDiff && resultText.length > 0) || terminalOutput.length > 0
```

### 2.2 MCP image content blocks - the one existing image path

An MCP image content block arrives as `ToolCallContent = { type: 'content', content: ContentBlock }`
with `ContentBlock.type === 'image'`. `renderContentItem` routes every non-text block into
`MediaBlocks`:

`ToolCallCard.tsx:141-147`
```tsx
  if (item.type === 'diff') {
    return <DiffPreview key={key} diff={diffContent(item)} />
  }
  if (item.type === 'content') {
    const c = item as { content?: ContentBlock }
    return c.content ? renderContentBlock(c.content, key, language) : null
  }
```

`ToolCallCard.tsx:89-105`
```tsx
function renderContentBlock(
  block: ContentBlock,
  key: number,
  language?: string
): React.JSX.Element {
  if (block.type === 'text' && language) {
    return <ResultBlock key={key} text={block.text ?? ''} language={language} />
  }
  if (block.type === 'text') {
    return (
      <div key={key} className="whitespace-pre-wrap break-words text-xs text-foreground/90">
        {block.text ?? ''}
      </div>
    )
  }
  return <MediaBlocks key={key} blocks={[block]} />
}
```

The `ContentBlock` contract itself is intentionally open - only `text` is typed, so image blocks
carry their protocol fields through the index signature:

`src/renderer/lib/acp-api.ts:48-57`
```ts
/**
 * Tagged content block. `text` is the only block with a typed field; other
 * block types (image/audio/resource/resource_link/...) carry their protocol
 * fields in the index signature.
 */
export interface ContentBlock {
  type: string
  text?: string
  [k: string]: unknown
}
```

### 2.3 The existing image/attachment renderer: `MediaBlocks`

`MediaBlocks` lives in **`ChatMessage.tsx`** and is imported by `ToolCallCard.tsx:28`
(`import { MediaBlocks } from './ChatMessage'`). It is the single image/audio/resource renderer in
the chat, used in three places: agent messages, user messages, and tool results.

`src/renderer/components/chat/ChatMessage.tsx:261-289`
```tsx
/** Render media blocks with safe inline previews and bounded embedded text. */
export function MediaBlocks({ blocks }: { blocks: ContentBlock[] }): React.JSX.Element | null {
  const media = mediaBlocks(blocks)
  if (media.length === 0) return null
  const resources = media.filter((block) => block.type === 'resource')
  const attachments = media.filter(
    (block) =>
      (block.type !== 'audio' || !inlineAudioUrl(block)) &&
      !(block.type === 'resource' && typeof blockResource(block)?.text === 'string')
  )
  const audio = media.filter((block) => block.type === 'audio')
  return (
    <>
      {attachments.length > 0 && (
        <Attachments variant="grid" className="ml-0 w-fit py-0.5">
          {attachments.map((block, i) => (
            <MediaGridItem key={`${block.type}-${i}`} block={block} id={`${block.type}-${i}`} />
          ))}
        </Attachments>
      )}
      {audio.map((block, i) => (
        <InlineAudio key={`audio-${i}`} block={block} />
      ))}
      {resources.map((block, i) => (
        <ResourceText key={`resource-${i}`} block={block} />
      ))}
    </>
  )
}
```

Each image is a **96x96 grid thumbnail**, clickable into a full-screen lightbox:

`ChatMessage.tsx:165-209` (excerpt)
```tsx
/** A single media block rendered as an AI Elements grid attachment. */
function MediaGridItem({ block, id }: { block: ContentBlock; id: string }): React.JSX.Element {
  const initial = useMemo(() => blockToAttachmentData(block, id), [block, id])
  const [data, setData] = useState(initial)
  const name = blockDisplayName(block)
  // Images preview in a lightbox; non-image file/embedded blocks render as a
  // static icon card. Nothing opens a backing path - temp/file paths can live
  // in sandboxed dirs the OS opener refuses, which would surface as an error.
  const inlineImage = blockIsImage(block) && Boolean(data.url)
  // (lines 173-196 elided: the file:// preview effect)
  if (inlineImage) {
    return (
      <ImageLightbox src={data.url ?? ''} alt={name}>
        {attachment}
      </ImageLightbox>
    )
  }
```

The thumbnail size is fixed in `components/ai-elements/attachments.tsx`:

```tsx
const renderAttachmentImage = (url: string, filename: string | undefined, isGrid: boolean) =>
  isGrid ? (
    <img
      alt={filename || 'Image'}
      className="size-full object-cover"
      height={96}
      src={url}
      width={96}
    />
  ) : (
```

**Is there an existing image/attachment renderer a viewport could replace or sit beside?**
Yes - `MediaBlocks`, and the correct relationship is **sit beside**, not replace:

- `MediaBlocks` is the right renderer for *arbitrary* MCP media (screenshots, diffs-as-images,
  user attachments). It should keep working unchanged.
- A viewport is the right renderer for *known 3D/garment artifacts*, which carry structured data
  (`design` JSON, atlas, rig) that `ContentBlock` cannot express.
- The natural seam is `renderContentBlock` (`ToolCallCard.tsx:89`): add a branch that detects an
  artifact-bearing block (or, better, a new `ToolCallContent` type) before falling through to
  `MediaBlocks`. `renderContentItem` (`ToolCallCard.tsx:135`) is already exported for reuse by
  `SubagentDetailsDialog`, so a new branch there is inherited by the subagent dialog for free.

### 2.4 The hard size limit that blocks an inline viewport inside a tool card

`acp-store` clamps live tool-call content aggressively. Any artifact bytes embedded in a
`ToolCallContent` will be **destroyed** past these bounds:

`src/renderer/stores/acp-store/slices/transcript.ts:327` / `:335` / `:219`
```ts
const MAX_LIVE_TOOL_CALL_FIELD_CHARS = 64 * 1024
const MAX_LIVE_TOOL_CALL_CONTENT_CHARS = 256 * 1024
const MAX_LIVE_RAW_OUTPUT_CHARS = 32 * 1024
```

`transcript.ts:427-437`
```ts
    // 'terminal' items are tiny; anything else oversized - non-text content
    // blocks like image base64, or unknown item shapes - is replaced
    // wholesale since a partially clamped unknown shape is more misleading
    // than an explicit omission. The bound is 2x the leaf clamp so a
    // legitimate max-size text leaf + JSON envelope is never mistaken for
    // an oversized item.
    if (serializedLength(item) > MAX_LIVE_TOOL_CALL_FIELD_CHARS * 2) {
      changed = true
      return OMITTED_CONTENT_ITEM
    }
```

and the marker it substitutes is a text block, so the artifact is gone with no trace:

`transcript.ts:355-359`
```ts
/** Marker substituted for a non-text/unknown content item over the field bound. */
const OMITTED_CONTENT_ITEM: ToolCallContent = {
  type: 'content',
  content: { type: 'text', text: '[termul: oversized tool call content item omitted]' }
}
```

**Consequence:** a viewport must not carry its payload through `ToolCallContent`. It must read the
artifact from a store keyed by `(sessionId, taskId)`, not from the transcript. This is the single
strongest argument against mounting the viewport inside the message list.

---

## 3. The generator result path

### 3.1 What a finished task's `built` object contains

`buildClothing` returns a `BuildResult`. The shape is declared in `types.ts:33-42` and produced at
`build.ts:146-159`.

`src/renderer/lib/generator/types.ts:33-42`
```ts
export interface BuildResult {
  /** The normalized spec the engine accepted. */
  spec: unknown
  /** dataURL of the review sheet shown back to the model. */
  sheet?: string
  report: BuildReport
  /** Textual description for vision-less models. */
  layout?: string
  [key: string]: unknown
}
```

`src/renderer/lib/generator/engines/clothing/build.ts:146-159`
```ts
  return {
    spec: normalized,
    sheet: review ?? template,
    template,
    report: {
      ok: check.ok,
      issues: check.issues,
      width: drawn.width,
      height: drawn.height,
      size: check.size,
      empty: check.empty
    },
    layout: [layerLayout(normalized, check), checkFacts(check.issues)].join('\n')
  }
```

| Field | Type | What it is |
| --- | --- | --- |
| `spec` | `ClothingDesign` (normalized) | The accepted design JSON - layers, colours, targets |
| `sheet` | `data:image/jpeg;base64,...` | The **avatar review strip**: three 3D poses + the atlas, 4 cells |
| `template` | `data:image/png;base64,...` | The **flat UV atlas** - the uploadable artifact |
| `report` | `BuildReport` | `ok`, `issues[]`, `width`, `height`, `size`, `empty[]` |
| `layout` | `string` | Textual layer inventory + check facts, for vision-less models |

Note that `template` is **not** in `BuildResult`; it is an extra property allowed by the
`[key: string]: unknown` index signature, which is why consumers cast it
(`generate-clothing.ts:239` does `built?.built?.template as string | undefined`).

The distinction is load-bearing and documented at `build.ts:102-108`:

```ts
 * `sheet` is the review image and `template` the flat atlas. They are different
 * pictures on purpose: the review turn shows the garment worn on an avatar, which
 * is the only way a model can judge drape, proportion and motif placement. The
 * atlas is still returned because it is the artifact that gets uploaded.
```

Note `sheet: review ?? template` - when WebGL is unavailable the sheet silently degrades to the
flat atlas. `reviewSheet` swallows the failure:

`build.ts:169-180`
```ts
function reviewSheet(
  drawn: SheetCanvas,
  type: DesignType,
  { rig, skin }: { rig?: Rig; skin?: string }
): string | null {
  try {
    const atlas = drawn as unknown as HTMLCanvasElement
    return renderClothingSheet({ [type]: atlas }, atlas, { rig, skin })
  } catch {
    return null
  }
}
```

### 3.2 Where `built` lives

`built` is a `LoopResult` field, and a `LoopResult` is what a task handler resolves with, so it ends
up on `TaskRecord.result`.

`types.ts:142-147`
```ts
/** What a finished generation produced. */
export interface LoopResult {
  result: unknown
  built: BuildResult
  notes: string[]
}
```

`src/renderer/lib/generator/task-queue.ts:17-33`
```ts
/** The record the UI and the poller both read (`tasks:250-265`). */
export interface TaskRecord {
  id: string
  kind: string
  title: string
  /** What the caller asked for; the handler reads it instead of closing over it. */
  params?: unknown
  status: TaskStatus
  /** Human-readable progress, e.g. `designing`. */
  stage: string
  detail: string | null
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  result: unknown
  error: string | null
}
```

`task-queue.ts:243-249`
```ts
    try {
      const result = await handler({ signal: controller.signal, report, task })
      if (controller.signal.aborted) {
        this.settle(task, 'cancelled', null, null)
      } else {
        this.settle(task, 'done', truncateResult(result), null)
      }
```

`truncateResult` (`task-queue.ts:73-78`) only truncates **strings**, so the `LoopResult` object
survives intact - `built.sheet` and `built.template` are full data URLs in memory:

```ts
/** Truncate a result the way the task log does, keeping the notice. */
export function truncateResult(result: unknown): unknown {
  if (typeof result !== 'string') return result
  if (result.length <= TASK_RESULT_CAP) return result
  const cut = result.length - TASK_RESULT_CAP
  return `${result.slice(0, TASK_RESULT_CAP)}\n\n... (cut ${cut} characters)`
}
```

### 3.3 How it reaches the UI today - it does not

This is the key finding. The `TaskQueue` is instantiated **inside `startGeneratorGateway`** and is
never exported, never placed in a store, and never subscribed to by any component:

`src/renderer/lib/generator-gateway.ts:50`
```ts
  const queue = options.queue ?? new TaskQueue()
```

`generator-gateway.ts:57-83` wires that queue into the handler and returns a teardown; nothing
exposes the queue:

```ts
  gateway.setHandler(
    createGeneratorHandler({
      queue,
      clothing: {
        queue,
        // (remaining ClothingToolDeps fields elided)
      }
    })
  )

  return () => {
    gateway.setHandler(null)
    queue.cancelAll()
  }
```

A grep for `onChange`/`onFinished` producers confirms the callbacks exist on `TaskQueueOptions`
(`task-queue.ts:46-55`) but **no production call site ever passes them** - only tests do
(`__tests__/task-queue.test.ts:123`, `:270`). So `TaskQueue` emits into the void:

`task-queue.ts:46-55`
```ts
export interface TaskQueueOptions {
  /** Defaults to `TASK_CONCURRENCY`; clamped to `1..4`. */
  concurrency?: number
  /** Fired on every observable change, already throttled. */
  onChange?: (tasks: TaskRecord[]) => void
  /** Fired once when a task settles, whatever the outcome. */
  onFinished?: (task: TaskRecord) => void
  /** Clock override; tests use it to keep ids deterministic. */
  now?: () => number
}
```

The only consumer of the finished artifact is the **MCP child**, via the poll tool.
`readClothingResult` flattens `built` into the tool reply:

`src/renderer/lib/generator/tools/generate-clothing.ts:230-245`
```ts
  if (task.status === 'done') {
    const built = task.result as { result?: unknown; built?: BuildResult } | null
    const spec = built?.built?.spec as { type?: DesignType; name?: string } | undefined
    return {
      status: 'done',
      taskId,
      stage: task.stage,
      design: built?.built?.spec ?? built?.result ?? null,
      image: built?.built?.sheet,
      atlas: built?.built?.template as string | undefined,
      kind: spec?.type,
      name: spec?.name,
      report: built?.built?.report,
      layout: built?.built?.layout,
      summary: `${task.title} is ready`
    }
  }
```

That reply goes to the host, which **strips `atlas`** and lifts `image` into an MCP image block:

`src-tauri/src/acp/host_mcp/child.rs:277-316` (excerpt)
```rust
/// A generator reply, with its `image` lifted into a real MCP image block.
///
/// The engines answer with a `data:image/png;base64,...` URL. Leaving it inside
/// the JSON text means the agent has to decode base64 by hand to see anything,
/// and in practice it goes looking on disk instead - so the bytes become an
/// image content block and the JSON keeps everything else.
///
/// `atlas` is dropped here rather than in the engine: the host already consumed
/// it to write the file, and a second copy of the same bytes in the transcript
/// costs context and invites the agent to decode it by hand.
pub(crate) fn generator_result(mut result: serde_json::Value) -> CallToolResult {
    if let Some(fields) = result.as_object_mut() {
        fields.remove("atlas");
    }
    let image = result
        .as_object_mut()
        .and_then(|fields| fields.remove("image"))
        .and_then(|value| value.as_str().map(str::to_string));
    // (mime-splitting block elided)
    let mut out = CallToolResult::structured(result);
    out.content = vec![
        rmcp::model::ContentBlock::text(text),
        rmcp::model::ContentBlock::Image(base64, mime),
    ];
    out
}
```

So the artifact's journey is: **renderer canvas -> data URL -> renderer `TaskQueue` -> tool reply ->
host -> MCP image block -> agent's tool call content -> back to the renderer -> `MediaBlocks`
thumbnail.** The renderer *had* the rich object and threw it away, then re-receives a flattened,
degraded copy (atlas stripped, `report`/`layout` still in the JSON text) as a 96px thumbnail.

**This is the gap the viewport closes.** The viewport should read `built` directly from a store at
the moment the task settles, not wait for the round trip.

---

## 4. The ACP event path

### 4.1 The generator gateway client

`src/renderer/lib/acp-transport/generator-gateway-client.ts` is the renderer leg. It defines the
event name and the two message shapes:

`generator-gateway-client.ts:16-31`
```ts
/** The event carrying one generator call from the host. */
export const GENERATOR_CALL_EVENT = 'acp:generator_call'

/** The `/ws` request that answers it. */
export const GENERATOR_REPLY_REQUEST = 'generator_reply'

/** One generator call as the host forwards it. */
export interface GeneratorCall {
  agentId: string
  sessionId: string
  callId: number
  /** The agent's tool name, e.g. `generate_clothing` or `get_3d_task`. */
  tool: string
  /** The tool arguments as JSON text, unparsed. */
  arguments: string
}
```

The client owns **no artifact data** - it only carries the *call*. Its handler is `handleCall`
(`generator-gateway-client.ts:62`), which runs the handler and posts a `GeneratorReply`. It never
emits anything toward the UI:

`generator-gateway-client.ts:61-81`
```ts
  /** One `acp:generator_call` event, run and answered. */
  async handleCall(call: GeneratorCall): Promise<void> {
    const reply = await this.run(call)
    if (!this.transport.isLive()) {
      void logFrontendError({
        level: 'warn',
        source: 'generator-gateway',
        message: `${call.tool} finished with no live connection; its answer is lost`
      })
      return
    }
    try {
      await this.transport.request(GENERATOR_REPLY_REQUEST, reply)
    } catch (error) {
      void logFrontendError({
        level: 'warn',
        source: 'generator-gateway',
        message: `${call.tool} reply failed: ${String(error)}`
      })
    }
  }
```

### 4.2 How `acp:generator_call` arrives

The event name is registered in the ACP event catalogue:

`src/renderer/lib/acp-api.ts:781`
```ts
  generatorCall: 'acp:generator_call',
```

The transport constructs the client as a readonly field:

`src/renderer/lib/acp-transport/ws-transport.ts:279-282`
```ts
  readonly generator = new GeneratorGatewayClient({
    request: (type, payload) => this.request(type, payload),
    isLive: () => this.isSocketLive()
  })
```

The store subscribes and dispatches into it - **and does nothing else with the result**:

`src/renderer/stores/acp-store/index.ts:670-672`
```ts
    acpApi.onEvent<GeneratorCall>(ACP_EVENTS.generatorCall, (e) => {
      void getAcpTransport().generator?.handleCall(e)
    })
```

That is the complete list of listeners for `acp:generator_call` in the renderer. **Nothing renders
its results.** The return value of `handleCall` is `Promise<void>` and is discarded.

The host side confirms the same contract - the event is fanned out per session and the host parks
the agent's tool call on a oneshot channel:

`src-tauri/src/acp/host_mcp/parent/generator.rs:26-38`
```rust
/// Event carrying one generator call to the renderer.
pub const EVENT_GENERATOR_CALL: &str = "acp:generator_call";

/// Parent -> renderer: one generator call to run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorCallEvent {
    pub agent_id: String,
    pub session_id: String,
    pub call_id: u64,
    pub tool: String,
    pub arguments: String,
}
```

`generator.rs:85-96` (excerpt)
```rust
        events::fan_out(
            &self.sinks,
            Some(session_id),
            EVENT_GENERATOR_CALL,
            &event,
        );
        // (a debug! log line elided)
        let outcome = tokio::time::timeout(GENERATOR_CALL_TIMEOUT, waiting).await;
```

`generator.rs:19-24`
```rust
/// How long the host waits for the renderer to answer one generator call.
///
/// A `generate_*` call only queues work and a `get_*_task` call only reads a
/// task, so both answer in milliseconds; the generation itself runs on the
/// renderer's task queue and is never awaited here.
pub const GENERATOR_CALL_TIMEOUT: Duration = Duration::from_secs(30);
```

This timeout is why the tool is a queue-and-poll: generation takes minutes, so
`queueGenerateClothing` returns a `taskId` immediately (`generate-clothing.ts:184-189`) and the
agent polls `get_clothing_task`.

### 4.3 Which tools exist, and the 3D gap

`gateway-handler.ts` enumerates the engines that are *named* but **not implemented** - and
`generate_3d` is first in the list:

`src/renderer/lib/generator/gateway-handler.ts:19-39`
```ts
/** Which engine each tool family needs, for the refusal message. */
const UNAVAILABLE = new Set([
  'generate_3d',
  'get_3d_task',
  'generate_sfx',
  'get_sfx_task',
  'generate_texture',
  'get_texture_task',
  'generate_skybox',
  'get_skybox_task',
  'generate_icon',
  'get_icon_task',
  'generate_vfx',
  'get_vfx_task',
  'generate_gfx',
  'get_gfx_task',
  'generate_animation',
  'get_animation_task',
  'generate_cutscene',
  'get_cutscene_task'
])
```

`gateway-handler.ts:75-84`
```ts
  if (UNAVAILABLE.has(call.tool)) {
    return {
      callId: call.callId,
      ok: false,
      error:
        `${call.tool} has no engine in this build yet. Only the clothing generator is ` +
        'implemented; the others are listed so the tool names are stable. Tell the user ' +
        'this engine is not available rather than approximating it another way.'
    }
  }
```

Only two tools dispatch (`gateway-handler.ts:86` `generate_clothing`, `:113` `get_clothing_task`).
**A future `generate_3d` will flow through exactly the same queue and the same reply shape**, which
is why the viewport must key off the *artifact*, not the tool name.

---

## 5. Existing 3D / WebGL infrastructure

### 5.1 Installed version

`package.json:199` / `package.json:217`
```json
    "three": "^0.186.1",
```
```json
    "@types/three": "^0.186.0",
```

Resolved install: **`three@0.186.1`** (`node_modules/three/package.json` reports
`{"name":"three","version":"0.186.1"}`).

### 5.2 Every `three` import in `src/`

Exactly two files, both inside the clothing engine's avatar renderer:

```
src/renderer/lib/generator/engines/clothing/avatar/avatar.ts:38:  } from 'three'
src/renderer/lib/generator/engines/clothing/avatar/avatar.ts:39: import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
src/renderer/lib/generator/engines/clothing/avatar/sheet.ts:19: import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
```

There is **no** three.js usage anywhere else in the app. No existing viewport component exists.
The `three/addons/*` subpath is already proven to resolve under Vite (used at `avatar.ts:39`), so
`three/addons/controls/OrbitControls.js` is available with no config change.

### 5.3 Patterns worth reusing - the shared-renderer singleton

`sheet.ts:52-67` establishes the "one WebGL context per window" pattern, which a live viewport must
respect (a second `WebGLRenderer` costs a second GPU context, and WebView2 caps them):

```ts
let sharedRenderer: WebGLRenderer | null = null

/** One renderer per window: creating a WebGL context is expensive. */
function renderer(width: number, height: number): WebGLRenderer {
  if (!sharedRenderer) {
    sharedRenderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    sharedRenderer.outputColorSpace = 'srgb'
  }
  sharedRenderer.setPixelRatio(1)
  sharedRenderer.setSize(width, height, false)
  return sharedRenderer
}
```

with a matching teardown at `sheet.ts:184-188`:

```ts
/** Release the shared WebGL context, for a window that is going away. */
export function disposeRenderer(): void {
  sharedRenderer?.dispose()
  sharedRenderer = null
}
```

Note `preserveDrawingBuffer: true` exists specifically so `gl.domElement` can be read back as a
picture (`renderView` returns `gl.domElement` at `sheet.ts:106`). A live viewport does **not** need
it and should not inherit it (it costs performance). It should own its own renderer, or share via a
refcounted accessor.

Also note `setSize(width, height, false)` - the `false` is `updateStyle`, which is right for an
offscreen render and wrong for a live canvas that must fill its container.

### 5.4 Patterns worth reusing - the scene/camera/light rig

`sheet.ts:26-50` holds the camera framing constants a viewport would want to match:

```ts
/** The camera directions upstream uses, as unit-ish vectors. */
const VIEWS = {
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [1, 0.12, 0.15],
  right: [-1, 0.12, 0.15],
  '3/4': [0.75, 0.25, 1]
} as const

/** The look-at point: chest height on the R15 rig. */
const TARGET = [0, 2.75, 0] as const
/** How far the camera sits from the target. */
const DISTANCE = 12.5
/** Vertical field of view. */
const FOV = 30
/** The background the panel strip is painted on. */
const BACKDROP = '#101113'
/** Cell width in the strip; the strip is four cells wide. */
const CELL = 256
/** Strip height, `CELL * 1.4`. */
const STRIP_H = Math.round(CELL * 1.4)
const STRIP_W = CELL * 4
/** JPEG quality for the review image. */
const JPEG_QUALITY = 0.85
/** The single-view thumbnail's size. */
const THUMB = 256
```

`sheet.ts:69-84` is the lighting rig (ambient 1.8 + key 1.9 from `(3,8,7)` + fill 0.9 from
`(-3,5,-7)`):

```ts
/** The lighting rig, identical for every view. */
function sceneFor(avatar: ReturnType<typeof buildAvatar>): Scene {
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.8))

  const key = new DirectionalLight(0xffffff, 1.9)
  key.position.set(3, 8, 7)
  scene.add(key)

  const fill = new DirectionalLight(0xffffff, 0.9)
  fill.position.set(-3, 5, -7)
  scene.add(fill)

  scene.add(avatar.group)
  return scene
}
```

`sheet.ts:86-107` builds the `PerspectiveCamera` and `lookAt`s the target - directly reusable as the
viewport's default framing:

```ts
/** Render one camera direction to a canvas. */
function renderView(
  scene: Scene,
  direction: readonly [number, number, number],
  width: number,
  height: number
): HTMLCanvasElement {
  const gl = renderer(width, height)
  const camera = new PerspectiveCamera(FOV, width / height, 0.1, 100)

  const [tx, ty, tz] = TARGET
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1
  camera.position.set(
    tx + (direction[0] / length) * DISTANCE,
    ty + (direction[1] / length) * DISTANCE,
    tz + (direction[2] / length) * DISTANCE
  )
  camera.lookAt(tx, ty, tz)

  gl.render(scene, camera)
  return gl.domElement
}
```

### 5.5 Patterns worth reusing - the avatar builder and rig

`buildAvatar` (`avatar/avatar.ts:246`) returns a ready `Group` plus a pose API - the exact object a
viewport needs:

`avatar.ts:230-237`
```ts
/** The built avatar, plus the joints a caller may pose. */
export interface Avatar {
  group: Group
  rig: Rig
  joints: Record<string, Group>
  setPose(joints: JointPose): void
  dispose(): void
}
```

`avatar.ts:359-376`
```ts
  return {
    group,
    rig,
    joints,
    setPose,
    dispose: () => {
      group.traverse((object: Object3D) => {
        const mesh = object as Mesh
        mesh.geometry?.dispose?.()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          if (!material) continue
          ;(material as MeshStandardMaterial).map?.dispose?.()
          material.dispose?.()
        }
      })
    }
  }
```

The `dispose()` is mandatory for a viewport: every rebuild of the avatar (a new skin tone, a new
rig) must dispose the previous one or the GPU leaks geometries and textures per regeneration.

The rig itself (`avatar/rig.ts`) already models the R15/R6 toggle the user asked for:

`rig.ts:14-15`
```ts
/** Which skeleton a render targets. */
export type Rig = 'R15' | 'R6'
```

`rig.ts:51-54`
```ts
/** The bones of a rig, in parent-before-child order. */
export function rigParts(rig: Rig): RigPart[] {
  return rig === 'R6' ? R6_PARTS : R15_PARTS
}
```

and named poses exist at `rig.ts:90-113` (`POSES.stand`, `POSES.heroic`, `DEFAULT_POSE`), applied
through `poseJoints` (`rig.ts:121`). The skin palette is `SKIN_TONES` (`avatar.ts:46-54`).

`buildAvatar`'s options are exactly the viewport's controls:

`avatar.ts:246-254`
```ts
export function buildAvatar({
  rig = 'R15',
  skin = SKIN_TONES[0].hex,
  clothes = {}
}: {
  rig?: Rig
  skin?: string
  clothes?: GarmentTextures
} = {}): Avatar {
```

**Bottom line for section 5:** every primitive a viewport needs (renderer, scene, lights, camera
framing, rigged avatar, R15/R6, poses, skin tones, dispose) already exists in
`src/renderer/lib/generator/engines/clothing/avatar/`. What does **not** exist is: an orbit
controller, a grid/ground plane, a React wrapper, a resize observer, and a render loop.

---

## 6. Styling and layout conventions

### 6.1 The stack

Tailwind CSS v4 + shadcn/ui (`new-york` style), configured in `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
```

`tailwind.config.ts` scans `./src/renderer/**/*.{ts,tsx}` and maps every colour to a CSS variable:

`tailwind.config.ts:19-22`
```ts
      colors: {
        border: 'oklch(var(--border) / <alpha-value>)',
        input: 'oklch(var(--input) / <alpha-value>)',
        'field-border': 'oklch(var(--field-border) / <alpha-value>)',
```

The chat-specific surfaces are mapped too, which is what a viewport chrome should use:

`tailwind.config.ts:85-93` (excerpt)
```ts
        terminal: {
          bg: 'oklch(var(--terminal-bg) / <alpha-value>)',
          fg: 'oklch(var(--terminal-fg) / <alpha-value>)'
        },
        surface: {
          dark: 'oklch(var(--surface-dark) / <alpha-value>)',
          darker: 'oklch(var(--surface-darker) / <alpha-value>)'
        },
```

### 6.2 How a component gets themed

**There are no per-component style files.** Everything is Tailwind utilities composed with `cn`
(`src/renderer/lib/utils.ts`, a `clsx` + `tailwind-merge` wrapper):

```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Colour tokens are OKLCH component triplets on `:root`, overwritten at startup by
`applyColorTheme`:

`src/renderer/index.css:114-126` (excerpt)
```css
@layer base {
  :root {
    /* Color tokens are OKLCH "L C H" components, read as oklch(var(--token)).
       These match Termul dark `applyColorTheme('termul')` so first paint
       equals runtime. applyColorTheme overwrites them at startup. */

    /* Termul dark first paint. Neutrals are the Linear void scale.
       Brand fill stays the composer blue. applyColorTheme overwrites these. */
    --background: 0.139 0.003 246.3;
    --foreground: 0.922 0.001 286.4;

    /* Surface colors for layered UI */
    --card: 0.172 0.003 248;
```

The theme engine is `src/renderer/lib/themes/apply-color-theme.ts` (`applyColorTheme`,
`COLOR_THEME_CHANGED_EVENT`). A canvas/WebGL surface cannot read CSS variables directly, so the
existing pattern is to **listen for the theme event and push values into the canvas** - see
`CanvasPanel.tsx:165-174`:

```tsx
  useEffect(() => {
    const pushTheme = (): void => useCanvasStore.getState().pushTheme(projectId)
    const pushLocale = (): void => useCanvasStore.getState().pushLocale(projectId)
    window.addEventListener(COLOR_THEME_CHANGED_EVENT, pushTheme)
    window.addEventListener('languagechange', pushLocale)
    return () => {
      window.removeEventListener(COLOR_THEME_CHANGED_EVENT, pushTheme)
      window.removeEventListener('languagechange', pushLocale)
    }
  }, [projectId])
```

A viewport should do the same: read `getComputedStyle` of a token (e.g. `--background`) on
`COLOR_THEME_CHANGED_EVENT` and set the `WebGLRenderer` clear colour. `CanvasShell`'s doc comment
records the related hard constraint - a native/`display:none` hidden surface stalls:

`src/renderer/components/canvas/CanvasShell.tsx:1-15` (excerpt)
```tsx
/**
 * The figcraft editor iframe for one mount. Owns the bridge for that mount:
 * the bridge starts listening first, then `src` is set programmatically so
 * the URL (it carries the `ct` token) never appears in the DOM attributes or
 * in a log. Remounting (a new `mountSeq`) is a new component instance.
 *
 * Rendered by `CanvasMountLayer`, never inside a tab: the iframe stays put in
 * the DOM and is laid over its panel's slot while the tab shows, or kept as
 * an offscreen 1x1 visible frame while it does not (AD-19). `display:none`
 * would stall the editor's message handling (figcraft SPIKE.md), so the
 * hidden state only moves and shrinks it.
```

The offscreen technique is exported as a constant and is directly reusable for a viewport that must
keep its context alive while hidden:

`CanvasShell.tsx:29-36`
```tsx
/** Off the viewport but still a laid-out, visible 1x1 frame. */
export const OFFSCREEN_FRAME_STYLE: CSSProperties = {
  position: 'fixed',
  left: '-10000px',
  top: '0px',
  width: '1px',
  height: '1px'
}
```

### 6.3 The panel / card / stage conventions

Shared class constants live in **`src/renderer/components/ui/panel-styles.ts`** - plain string
constants, no component. This is the file a viewport chrome should draw from:

`panel-styles.ts:25-40` (excerpt)
```ts
/** 28px panel-header icon button. */
export const PANEL_ICON_BUTTON_CLASS = `${QUIET_ICON_BUTTON_CLASS} size-7`

/** 40px panel header: `.label-panel` at the start, icon buttons at the end. */
export const PANEL_HEADER_CLASS = 'flex h-10 shrink-0 items-center justify-between pl-4 pr-1.5'

/** Panel text field: card fill, 3:1 field edge, neutral focus border. */
export const PANEL_FIELD_CLASS = `rounded-lg border border-field-border bg-card text-xs pointer-coarse:text-base text-foreground transition-colors duration-150 ease-out placeholder:text-muted-foreground ${FIELD_FOCUS_CLASS}`
```

The file's own header states the idiom - plain constants, composed with `cn`, sizing left to the
call site:

`panel-styles.ts:1-6`
```ts
/**
 * Shared class strings for panel chrome: sidebars, explorer, outline, Git
 * panel, settings and composer toggles. Same idiom as `menu-styles.ts`: plain constants that
 * call sites compose with `cn`. Height, width and padding stay at the call
 * site; these hold only the look that must stay the same everywhere.
 */
```

The chat's own panel idiom (the shape a viewport panel should copy) is a `rounded-lg` card with a
`ring-1` and a compact header row. From `PlanPanel.tsx:149-152`:

```tsx
            <section
              className="mx-auto w-full max-w-3xl overflow-hidden rounded-lg bg-card/30 ring-1 ring-border/50"
              aria-label="Execution plan"
            >
```

and its header button, which is the pattern for a viewport's toolbar:

`PlanPanel.tsx:161-165`
```tsx
                className={cn(
                  'flex w-full items-center gap-1.5 px-3 py-2 text-left text-2xs font-semibold text-muted-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  CHAT_HIT_MIN_H
                )}
```

Chat layout constants (gutters, hit targets) live in **`src/renderer/components/chat/chat-layout.ts`**
and are pane-width based, not viewport based - a fact any responsive viewport must account for:

`chat-layout.ts:1-27`
```ts
/**
 * Pane-scoped responsive layout helpers for ACP chat (Story 5.1).
 *
 * Breakpoints are **pane width**, not viewport - split panes on desktop make
 * `sm:`/`md:` viewport utilities wrong. Gutters use Tailwind `@container`
 * variants on the chat pane root; the composer toolbar uses a ResizeObserver
 * seam (`data-composer-toolbar`) because jsdom does not layout CSS container
 * queries reliably.
 */
// (lines 10-12 elided: the NARROW_PANE_PX doc comment)
/** Pane width below which the composer toolbar uses the explicit two-row layout. */
export const NARROW_PANE_PX = 400

/**
 * Horizontal chat column gutter: tighter on narrow panes, `px-3` (12px) or
 * `px-5` (20px) when the pane container is >= {@link NARROW_PANE_PX}.
 */
export const CHAT_GUTTER_X = 'px-3 @[400px]:px-5'
```

The chat column is capped at `max-w-3xl` everywhere (`ChatMessageList.tsx:261`, `:278`; `PlanPanel`,
`ChatChangedFilesPanel`, `BrowserConsentCard` wrappers all use `mx-auto w-full max-w-3xl`). A
viewport that is *inline in the transcript* inherits that 768px cap; a viewport that is a *global
overlay* does not.

Motion is centralized in `chat-motion.ts` (`CHAT_SPRING`, `CHAT_SPRING_SOFT`, `CHEVRON_TRANSITION`)
and every animation is gated on `useReducedMotion()`.

---

## 7. Mount points - the recommendation

### 7.1 The decision

**Mount the global viewport as a sibling of `CanvasMountLayer` in `WorkspaceLayout`, fed by a new
`artifact-store`.**

Do **not** mount it inside `AgentChatPanel` or `ChatMessageList`. Three independent reasons:

1. **Payload size.** `acp-store` destroys any `ToolCallContent` over 128 KiB
   (`transcript.ts:433`, `MAX_LIVE_TOOL_CALL_FIELD_CHARS * 2`). A garment atlas + avatar sheet is
   far larger. The artifact must never travel through the transcript.
2. **Virtualization.** `ChatMessageList` mounts only near-viewport rows
   (`ChatMessageList.tsx:113-119`, `useVirtualizer` with `overscan: 6`), so an inline WebGL canvas
   would be created and destroyed on every scroll - each one a GPU context.
3. **Multiplicity.** Every non-active `agent-chat` tab stays mounted
   (`PaneContent.tsx:572` + `INACTIVE_TAB_PANE_CLASS` at `PaneContent.tsx:32`), so an inline
   viewport would exist once per open chat, all invisible. A single global instance is the only
   sane model for a WebGL surface.

The virtualization constraint, verbatim:

`src/renderer/components/chat/ChatMessageList.tsx:112-119`
```tsx
  const { viewportEl, pinned } = useMessageScroller()
  const virtualizer = useVirtualizer({
    count: groupedItems.length,
    getScrollElement: () => viewportEl,
    estimateSize: () => 120,
    overscan: 6,
    getItemKey: (i) => groupedItems[i]?.key ?? i
  })
```

The multiplicity constraint, verbatim:

`src/renderer/components/workspace/PaneContent.tsx:31-32`
```tsx
/** Inactive tabs stay mounted but must not intercept clicks on the active tab beneath them. */
const INACTIVE_TAB_PANE_CLASS = 'w-full h-full absolute inset-0 invisible pointer-events-none'
```

### 7.2 The exact mount point

`src/renderer/layouts/WorkspaceLayout.tsx:306-329` - the desktop return. The layer is already
rendered beside `ShellFrame`, outside the pane tree, and is duplicated in the two other render
branches (`:273` unauthorized, `:301` mobile) for the same reason:

```tsx
  return (
    <>
      <ShellFrame
        projects={projects}
        activeProject={activeProject}
        activeProjectId={activeProjectId}
        ssh={ssh}
        isShortcutMenuOpen={isShortcutMenuOpen}
        setIsShortcutMenuOpen={setIsShortcutMenuOpen}
        setIsCommandPaletteOpen={setIsCommandPaletteOpen}
        setIsNewProjectModalOpen={setIsNewProjectModalOpen}
        onSelectProject={handleSelectProject}
        handleAddGitTab={tabOpeners.handleAddGitTab}
        handleAddGitHistoryTab={tabOpeners.handleAddGitHistoryTab}
        handleToggleThemePicker={handleToggleThemePicker}
        handleOpenAgentChat={tabOpeners.handleOpenAgentChat}
        handleOpenCanvas={tabOpeners.handleOpenCanvas}
        handleOpenRoblox={tabOpeners.handleOpenRoblox}
        workspaceMain={workspaceMain}
        appModals={appModals}
      />
      <CanvasMountLayer key="canvas-mount-layer" />
    </>
  )
```

**Recommended insertion - `WorkspaceLayout.tsx:328`, immediately after `CanvasMountLayer`:**

```tsx
      <CanvasMountLayer key="canvas-mount-layer" />
      <ArtifactViewportLayer key="artifact-viewport-layer" />   // <- new
    </>
```

and the matching sibling at `:274` (unauthorized branch) and `:302` (mobile branch). All three
branches need it for the same reason `CanvasMountLayer` is in all three: a breakpoint flip or a
token re-gate must not unmount the WebGL context.

The three call sites, verbatim:

```
src/renderer/layouts/WorkspaceLayout.tsx:273:        <CanvasMountLayer key="canvas-mount-layer" />
src/renderer/layouts/WorkspaceLayout.tsx:301:        <CanvasMountLayer key="canvas-mount-layer" />
src/renderer/layouts/WorkspaceLayout.tsx:327:      <CanvasMountLayer key="canvas-mount-layer" />
```

### 7.3 Why this precedent is the right one

`CanvasMountLayer` is *exactly* the pattern requested - a single global overlay that survives tab
switches, project switches, and shell breakpoints. Its own doc comment states the contract:

`src/renderer/components/canvas/CanvasMountLayer.tsx:1-12`
```tsx
/**
 * Every mounted canvas's iframe, kept outside the tab tree (spine AD-19). A
 * mount lives from its first open until the host unmounts it, whatever
 * happens to its tab: closing the tab, switching tabs or projects, or moving
 * the tab to another pane only changes whether a visible `CanvasPanel` slot
 * exists, so the editor keeps its state and keeps answering agent calls.
 *
 * Rendered once by `WorkspaceLayout` (both renderer roots), beside either
 * shell, so a breakpoint change does not remount it either. It also hosts the
 * unsaved-canvas question of the unmount flow and the file watch that tells
 * the mounted canvases their documents changed on disk.
 */
```

and its body is a store subscription plus one shell per session:

`CanvasMountLayer.tsx:22-44`
```tsx
export function CanvasMountLayer(): React.JSX.Element {
  const sessions = useCanvasStore((state) => state.sessions)
  const slots = useCanvasSlots((state) => state.slots)
  useEffect(() => startCanvasDiskWatch(), [])

  return (
    <>
      {Object.values(sessions).map((session) => {
        const { phase } = session
        if (phase.kind !== 'loading' && phase.kind !== 'ready') return null
        return (
          <CanvasShell
            key={`${session.projectId}:${phase.mount.mountSeq}`}
            projectId={session.projectId}
            mount={phase.mount}
            title={`Canvas — ${basename(session.docPath)}`}
            slot={slots[session.projectId] ?? null}
          />
        )
      })}
      <CanvasUnmountDialog />
    </>
  )
}
```

The **slot registry** is the second half of the pattern and is what lets the overlay live globally
while appearing inline. A panel claims a DOM element; the global layer positions itself over it:

`src/renderer/components/canvas/canvas-slots.ts:1-30`
```ts
/**
 * Where each project's canvas shows. A visible `CanvasPanel` registers its
 * slot element here; `CanvasMountLayer` lays the project's iframe over that
 * slot, or offscreen when there is none. The iframe itself never moves in the
 * DOM, because re-parenting an iframe reloads it.
 */

import { create } from 'zustand'

interface CanvasSlotState {
  slots: Record<string, HTMLElement>
  claimSlot: (projectId: string, element: HTMLElement) => void
  /** Releases the slot only while `element` still holds it, so a panel that
   * unmounts after its successor claimed the slot does not clear it. */
  releaseSlot: (projectId: string, element: HTMLElement) => void
}
```

and the consumer follows the slot rect every frame:

`CanvasShell.tsx:55-79`
```tsx
/** The slot's viewport rectangle, followed every frame while there is a
 * slot: pane resizes, splits and sidebar moves all shift it. */
function useSlotRect(slot: HTMLElement | null): SlotRect | null {
  const [rect, setRect] = useState<SlotRect | null>(null)
  useEffect(() => {
    if (!slot) {
      setRect(null)
      return
    }
    let frame = 0
    let last: SlotRect | null = null
    const follow = (): void => {
      const box = slot.getBoundingClientRect()
      const next = { left: box.left, top: box.top, width: box.width, height: box.height }
      if (!sameRect(last, next)) {
        last = next
        setRect(next)
      }
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(frame)
  }, [slot])
  return slot ? rect : null
}
```

For a **WebGL canvas** the iframe caveat does not apply (a canvas *can* be re-parented without
reloading), but the slot registry is still the cleanest way to get both inline and full-screen
presentation from one component - and the `requestAnimationFrame` rect follower is exactly how a
viewport stays glued to a pane that is being resized.

### 7.4 What the viewport needs passed in

The viewport should take an **artifact descriptor**, not a tool call. Minimum shape:

```ts
/** One renderable artifact, from any engine. */
export interface ArtifactDescriptor {
  /** Stable identity: `${sessionId}:${taskId}`. Store key + React key. */
  id: string
  /** Which engine produced it: 'clothing' now, '3d'/'object' later. */
  kind: 'clothing' | string
  /** The session that asked, so the viewport can follow the active chat. */
  sessionId: string
  /** Engine-specific renderable data. */
  payload:
    | {
        kind: 'clothing'
        /** Flat UV atlas, `data:image/png;base64,...` - the texture source. */
        atlas: string
        /** Avatar review strip, `data:image/jpeg;base64,...` - fallback poster. */
        sheet?: string
        /** The accepted design, for the template/atlas inspector. */
        design: unknown
        type: 'shirt' | 'pants' | 'tshirt'
      }
    | { kind: 'mesh'; url: string }        // future: generated 3D
  /** Check results: `ok`, `issues[]`, `size`, `empty[]`. */
  report?: unknown
  /** Textual inventory for the "what it is" panel. */
  layout?: string
  /** Where the host wrote the file, when it did. */
  save?: { saved: boolean; path?: string; relative?: string; reason?: string }
  /** Human title, from the task. */
  title: string
}
```

The data for this comes from the **`TaskQueue`'s finished `TaskRecord`**, not from the transcript.
Two changes are needed to get it there:

**(a) Give `TaskQueue` a real `onFinished` sink.** The option already exists and is documented:

`task-queue.ts:46-55`
```ts
export interface TaskQueueOptions {
  /** Defaults to `TASK_CONCURRENCY`; clamped to `1..4`. */
  concurrency?: number
  /** Fired on every observable change, already throttled. */
  onChange?: (tasks: TaskRecord[]) => void
  /** Fired once when a task settles, whatever the outcome. */
  onFinished?: (task: TaskRecord) => void
  /** Clock override; tests use it to keep ids deterministic. */
  now?: () => number
}
```

and is already invoked at settle time (`task-queue.ts:278` `this.options.onFinished?.({ ...task })`).
Only `startGeneratorGateway` needs to supply it:

`src/renderer/lib/generator-gateway.ts:50`
```ts
  const queue = options.queue ?? new TaskQueue()
```
-> pass `onFinished` (and optionally `onChange` for live stage) that writes into a new
`useArtifactStore`. The `report` callback that drives live progress is already wired end to end -
`runClothingGeneration`'s `report` parameter is `TaskHandle.report`:

`generate-clothing.ts:193-222` (excerpt)
```ts
export async function runClothingGeneration(
  deps: ClothingToolDeps,
  args: GenerateClothingArgs,
  report: (stage: string, detail?: string | null) => void,
  signal: AbortSignal
): Promise<LoopResult> {
  // (brain/agent setup elided)
    onStage: ({ stage, detail }) => report(stage, detail ?? null)
  })

  report('done', 'Design ready')
  return outcome
}
```

so a live "designing / building / checking / fixing" indicator is available with no new plumbing.

**(b) Unflatten `built`.** `readClothingResult` currently projects `LoopResult` down to the tool
reply. The store hook should read the raw `TaskRecord.result` (`{ result, built, notes }`) so the
atlas (`built.template`) survives - the host strips `atlas` on the MCP path
(`child.rs:290-294`), but the renderer already holds it.

### 7.5 Secondary mount points (optional, in priority order)

| # | Location | Citation | What it buys |
| --- | --- | --- | --- |
| 1 | `WorkspaceLayout.tsx:328` (sibling of `CanvasMountLayer`) | this report, section 7.2 | **Primary.** Global, survives tab/project/breakpoint switches, one WebGL context |
| 2 | A `kind: 'artifact'` row in the timeline | `chat-timeline.ts:7-25` (mirror the `worktree` variant) | Inline presence in the transcript; renders a *poster + "Open" button* that raises the global viewport, never the canvas itself |
| 3 | A branch in `renderContentBlock` | `ToolCallCard.tsx:89-105` (before the `MediaBlocks` fallback) | Lets a tool result show a viewport *poster* instead of a 96px thumbnail; inherits into `SubagentDetailsDialog` via `renderContentItem` |
| 4 | A bar above the composer, beside `ChatChangedFilesPanel` | `AgentChatPanel.tsx:1019` | "1 artifact ready - Open" affordance next to the input |

Mount point 3 is the one that most directly replaces the current experience, and it is a
**two-line change** because `renderContentBlock` already has the exact "non-text block" seam:

`ToolCallCard.tsx:104`
```tsx
  return <MediaBlocks key={key} blocks={[block]} />
```

becomes:

```tsx
  const artifact = artifactForBlock(block)          // new: reads the artifact store
  if (artifact) return <ArtifactPoster key={key} artifact={artifact} />
  return <MediaBlocks key={key} blocks={[block]} />
```

Mount point 4 is the lightest-touch: `ChatChangedFilesPanel` already proves the pattern of a
collapsible summary bar sitting between the transcript and the composer
(`AgentChatPanel.tsx:1019-1026`), and it takes `toolCalls` directly, which is how an artifact bar
would learn an artifact exists.

### 7.6 The one thing that must not be done

Do **not** render the `WebGLRenderer` canvas inside `ChatMessageList`. It is virtualized
(`ChatMessageList.tsx:113-119`), it caps width at `max-w-3xl`, and every hidden chat tab stays
mounted (`PaneContent.tsx:32`, `:572`). A canvas there would be created on scroll-in, destroyed on
scroll-out, and duplicated per open chat. The `CanvasMountLayer` + slot-registry pattern exists
precisely to avoid this, and a viewport should follow it rather than reinventing an inline canvas.

---

## Appendix A - file index

| Concern | File | Key lines |
| --- | --- | --- |
| Session pane body | `src/renderer/components/chat/AgentChatPanel.tsx` | 121, 132-133, 661, 818, 918-920, 1019 |
| Transcript list + virtualization | `src/renderer/components/chat/ChatMessageList.tsx` | 99, 113-119, 181, 197-207, 312, 364, 373-390 |
| Tool-call rendering (owner) | `src/renderer/components/chat/ToolCallCard.tsx` | 28, 89-105, 135-178, 252-268, 490 |
| Message + media rendering | `src/renderer/components/chat/ChatMessage.tsx` | 150, 165, 172, 262-289 |
| Timeline model | `src/renderer/components/chat/chat-timeline.ts` | 7-25, 67, 287 |
| Chat layout constants | `src/renderer/components/chat/chat-layout.ts` | 1-27, 51-54 |
| Pane mounting | `src/renderer/components/workspace/PaneContent.tsx` | 32, 34-35, 551-574 |
| Global overlay precedent | `src/renderer/components/canvas/CanvasMountLayer.tsx` | 1-12, 22-44 |
| Slot registry precedent | `src/renderer/components/canvas/canvas-slots.ts` | 1-30 |
| Slot rect follower | `src/renderer/components/canvas/CanvasShell.tsx` | 29-36, 55-79 |
| Root layout | `src/renderer/layouts/WorkspaceLayout.tsx` | 32, 84-87, 273, 301, 327 |
| Generator gateway wiring | `src/renderer/lib/generator-gateway.ts` | 43-84 |
| Tool dispatch | `src/renderer/lib/generator/gateway-handler.ts` | 19-39, 60, 75-84, 86, 113 |
| Task runner | `src/renderer/lib/generator/task-queue.ts` | 17-33, 46-55, 73-78, 243-249, 278 |
| Artifact flattening | `src/renderer/lib/generator/tools/generate-clothing.ts` | 184-189, 193-222, 225-251 |
| Build result shape | `src/renderer/lib/generator/types.ts` | 33-42, 142-147 |
| Clothing build | `src/renderer/lib/generator/engines/clothing/build.ts` | 102-108, 146-159, 169-180 |
| ACP event client | `src/renderer/lib/acp-transport/generator-gateway-client.ts` | 16-31, 61-81 |
| Transport construction | `src/renderer/lib/acp-transport/ws-transport.ts` | 279-282 |
| Event subscription | `src/renderer/stores/acp-store/index.ts` | 670-672 |
| Host event + park | `src-tauri/src/acp/host_mcp/parent/generator.rs` | 19-27, 26-38, 85-96 |
| Host image lift | `src-tauri/src/acp/host_mcp/child.rs` | 277-316 |
| three.js renderer | `src/renderer/lib/generator/engines/clothing/avatar/sheet.ts` | 19, 26-50, 52-67, 69-84, 86-107, 184-188 |
| three.js avatar | `src/renderer/lib/generator/engines/clothing/avatar/avatar.ts` | 26-39, 46-54, 230-237, 246-254, 359-376 |
| Rig / R15-R6 / poses | `src/renderer/lib/generator/engines/clothing/avatar/rig.ts` | 14-15, 51-54, 90-113, 121 |
| Theme tokens | `src/renderer/index.css` | 114-126 |
| Theme engine | `src/renderer/lib/themes/apply-color-theme.ts` | - |
| Panel style constants | `src/renderer/components/ui/panel-styles.ts` | 1-6, 25-40 |
| Tailwind config | `tailwind.config.ts` | 19-22, 85-93 |
| Clamp limits (blocker) | `src/renderer/stores/acp-store/slices/transcript.ts` | 219, 327, 335, 355-359, 427-437 |

## Appendix B - the gap in one sentence

The renderer builds a rich artifact (`spec`, `sheet`, `template`, `report`, `layout`), stores it on
an in-memory `TaskQueue` nobody subscribes to, projects it down to a tool reply that the host strips
(`atlas` removed, `image` lifted into an MCP block), and the chat then re-renders it as a 96px
thumbnail - so the only thing missing is a store between `TaskQueue.onFinished` and a global
`ArtifactViewportLayer` mounted beside `CanvasMountLayer`.
