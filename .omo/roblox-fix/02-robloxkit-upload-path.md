# RobloxKit upload path — how a generated clothing PNG reaches Roblox, and what lands on disk

**Question answered:** after RobloxKit generates a clothing image, how does that image
actually get into Roblox (asset upload + Studio insertion), and what artifacts are written
to disk?

**Sources read for this document**

| Source | What it gave |
|---|---|
| `re/full-reverse/10-tool-surface/REPORT.md` (2,593 lines, read in full) | The 94-tool registry, every schema, `Tl` clothing group §3.7, `wn` upload tools §3.5, `Rd` image engine §3.17, dispatch §5, serialisation §5.2, `image`-returning tools §5.2b |
| `re/full-reverse/02-clothing/REPORT.md` (1,689 lines) | Render pipeline §4.5 `renderPng`, §5.1 thumbnail, §5.2 sheet, `saveClothingPng` |
| `re/full-reverse/11-persistence-state/REPORT.md` (2,849 lines) | §4 collections on disk, §6 upload/download pipeline, §7 media store, artifact layout |
| `re/07-roblox-integration/FINDINGS.md`, `FINDINGS-DEEP.md`, `FINDINGS-API-CONTRACT.md` | `/api/roblox/*` contract, media store, collections, error codes |
| `re/04-studio-bridge/FINDINGS.md`, `FINDINGS-DEEP.md`, `FINDINGS-DEEP-2.md`, `FINDINGS-PLUGIN-SOURCE.md` | StudioMCP.exe, the 30-tool `tools/list`, `upload_image` / `store_image` |
| `porting/04-tools/README.md`, `porting/02-transport/README.md` | The port's own restatement of the envelope and the context injection |
| `re/full-reverse/01-generator-loop/REPORT.md` §16.4–16.5 | Collection API and result envelope |
| **Verification against the de-minified bundle** `Robloxkit/artifacts/frontend_unmin/` | Every load-bearing claim below re-checked at `file:line` |
| **Verification against** `Robloxkit/artifacts/assistant_plugin.bin` | The Roblox Studio Assistant plugin's own `upload_image` / `store_image` / `insert_asset` strings |

> **`12-studio-bridge-acp/REPORT.md` does not exist.** The directory
> `re/full-reverse/12-studio-bridge-acp/` is present but **empty** (verified:
> `Get-ChildItem -Recurse -Force` returns nothing). There is no report to read. The
> Studio-bridge material lives in `re/04-studio-bridge/` instead, and that is what this
> document cites. This is a corpus gap, not an oversight.

---

## 0. The one-paragraph answer

**RobloxKit never uploads a clothing image to Roblox, and it never inserts a shirt into
Studio.** `generate_clothing` renders a 585x559 (or 512x512 for t-shirts) PNG in the
browser, writes `item.json` + a 256x256 `thumb.png` into
`Documents/RobloxKit/clothing/collection/<id>/`, and returns `{result, summary, image}`
where `image` is a **`data:image/png;base64,…` URL of the thumbnail**. There is no asset id
in the envelope, no file path in the envelope, and no upload call anywhere on the clothing
path. The human finishes the job: the Clothing panel's *Use it* section has a **Save PNG to
workspace** button (which writes `Documents/RobloxKit/clothing/<slug>.png`) and an **Open
Creator Dashboard** button that deep-links to
`https://create.roblox.com/dashboard/creations?activeTab=Shirt|Pants|TShirt`. The panel's
own copy says why: *"Roblox does not let apps publish classic clothing: the upload is
yours."*

A generic `upload_asset` tool **does** exist (`wn:437`), but it uploads to
`robloxkit.dev/api/roblox/upload` as base64-in-JSON, and **an image upload comes back as a
Decal**, not a Shirt — the UI says so verbatim: `` `Uploaded as asset ${id}${F === `image` ?
` (a Decal)` : ``}.` ``. Nothing in the corpus ever sets `ShirtTemplate` or
`PantsTemplate`; the strings do not occur in any of the 166 frontend bundles.

---

## 1. The exact tool surface for getting an image to Roblox

There are **four distinct layers** that can move an image, and they are easy to conflate.
Only layer A belongs to RobloxKit.

| Layer | Owner | Tools | Reaches Roblox? |
|---|---|---|---|
| **A. RobloxKit's own registry** | the RobloxKit SPA | `upload_asset`, `asset_status`, `upload_gfx`, `send_*_to_studio`, `write_file`, `image_render`, … | yes, via `robloxkit.dev` |
| **B. Roblox's built-in Studio Assistant plugin** | Roblox, not RobloxKit | `upload_image`, `store_image`, `insert_asset`, `search_asset` | yes, directly |
| **C. The chrrxs plugin** | third party, **not on RobloxKit's path** | `/api/insert-asset`, `/api/preview-asset` | yes, but irrelevant |
| **D. Termul's own host MCP** | Termul | **nothing** — no upload tool at all | no |

RobloxKit's registry is 94 tools; 91 reach `tools/list` (`10-tool-surface` §1). The tools
relevant to "get an image to Roblox" are exactly these:

### 1.1 `upload_asset` — the only real upload tool (`wn:437`)

Full schema, verbatim from `workspaceTools-oYxH4nqo.js:437-488`:

```js
{
  name: `upload_asset`,
  parameters: {
    type: `object`,
    properties: {
      path: { type: `string` },
      name: { type: `string` },
      description: { type: `string` },
      type: {
        type: `string`,
        enum: O,                                   // O = [`image`,`audio`,`video`,`model`]
        description: `Only needed when the extension does not say.`
      }
    },
    required: [`path`, `name`]
  },
  call: async (e, t, n) => {
    let r = t.type ?? A(t.path);
    if (!O.includes(r)) {
      throw Error(`Cannot tell what kind of asset ${t.path} is. Pass type as one of: ${O.join(`, `)}.`);
    }
    let s = j(await o(await E(t.path))).split(`,`)[1];        // data: URI -> base64
    let c = await a(`${i}/api/roblox/upload`, {
      method: `POST`,
      headers: {
        "Content-Type": `application/json`,
        ...(n?.token ? { Authorization: `Bearer ${n.token}` } : {})
      },
      body: JSON.stringify({
        type: r,
        filename: t.path.split(/[\\/]/).pop(),
        name: t.name,
        description: t.description ?? ``,
        data: s
      })
    });
    let l = await c.json().catch(() => ({}));
    if (!c.ok) {
      throw Error(l.error ?? `Upload failed (${c.status})`);
    }
    return {
      result: l,
      summary: l.asset_id ? `Uploaded as ${l.asset_id}` : `Upload queued for moderation`
    };
  }
}
```

**Gate:** `assets` (`10-tool-surface` Appendix B). **Route:** `HTTP POST
/api/roblox/upload`. **Returns:** whatever the server returns — `{asset_id}` or
`{operation_id, moderation_note}`. **No `image` key**, so no MCP image block.

**Critical detail — `path` is workspace-relative.** `E` is `resolvePath`
(`wn:103-120`); it rejects `..`, absolute paths, `X:` prefixes, dotfiles, control
characters, homoglyphs and 8.3 short names. So `upload_asset` can only upload a file that
already lives under `<Documents>/RobloxKit/`.

### 1.2 `asset_status` — the moderation poll (`wn:490`)

```js
{
  name: `asset_status`,
  parameters: {
    type: `object`,
    properties: { operation_id: { type: `string` } },
    required: [`operation_id`]
  },
  call: async (e, t, n) => {
    let r = await a(`${i}/api/roblox/upload/${encodeURIComponent(t.operation_id)}`, {
      headers: n?.token ? { Authorization: `Bearer ${n.token}` } : {}
    });
    let o = await r.json().catch(() => ({}));
    if (!r.ok) { throw Error(o.error ?? `Status check failed (${r.status})`); }
    return {
      result: o,
      summary: o.done ? `Upload finished` : `Still moderating`
    };
  }
}
```

Gate `assets`. This is the *only* way an agent can learn that an `operation_id` became an
`asset_id`.

### 1.3 `upload_gfx` (`index:20332`) — upload by collection id, GFX only

```js
{ type:`object`, properties:{ id: { type:`string` } }, required:[`id`] }
```

Gate `gen_gfx`. It renders the GFX at full size, calls `uploadAsset({type:'image', …})`,
polls `waitForUpload`, and returns `{assetId, …}`. If `asset_id` is missing it throws
`u.moderation_note ?? 'Roblox has not finished processing the upload yet; it will appear
under your Decals when it does.'` (`05-gfx` §9). **There is no `upload_clothing`
equivalent.**

### 1.4 The four `send_*_to_studio` / `insert_*` tools (Studio insertion)

These are the closest thing to "get it into Studio". None of them is for clothing.

| Tool | Line | Gate | Schema | What it inserts |
|---|---|---|---|---|
| `send_3d_to_studio` | `index:18789` | `gen_3d` | `{type:object,properties:{id:{type:string},unanchored:{type:boolean,description:"A character: leave even its root unanchored (it falls and stands under physics)"}},required:["id"]}` | GLB upload → `InsertService:LoadAsset` → model |
| `send_vfx_to_studio` | `index:20052` | `gen_vfx` | `{type:object,properties:{id:{type:string}},required:["id"]}` | textures uploaded → particle emitters |
| `send_icon_to_studio` | `index:20628` | `gen_icons` | `{type:object,properties:{id:{type:string},as:{type:string,enum:["ImageLabel","ImageButton"]}},required:["id"]}` | `ImageLabel`/`ImageButton` |
| `send_sfx_to_studio` | `index:20882` | `gen_sfx` | `{type:object,properties:{id:{type:string}},required:["id"]}` | `Sound` |
| `insert_music` | `index:21963` | `studio_tools` | `{type:object,properties:{ids:{type:array,items:{type:string}},player:{type:boolean},zones:{type:boolean},crossfade:{type:number}},required:["ids"]}` | `Sound`(s) |
| `insert_cutscene` | `index:21095` | `gen_cutscene` | `{type:object,properties:{id:{type:string},trigger:{type:string,enum:[...]}},required:["id"]}` | `CutscenePlayer` |
| `insert_animation` | `index:21342` | `gen_anim` | `{type:object,properties:{id:{type:string},emote:{type:boolean},key:{type:string,enum:[...]}},required:["id"]}` | `Animation` |

**The `Tl` clothing group has no `send_` tool at all.** Its four tools are:

| Tool | Line | Gate | Schema |
|---|---|---|---|
| `list_clothing_collection` | `index:18893` | `gen_clothing` | `{type:object,properties:{type:{type:string,enum:["shirt","pants","tshirt"]}}}` |
| `generate_clothing` | `index:18913` | `gen_clothing` | `{type:object,properties:{prompt:{type:string},type:{type:string,enum:["shirt","pants","tshirt"]},design:{type:object,description:"Optional: a complete design instead of a prompt"}},required:["type"]}` |
| `edit_clothing` | `index:18982` | `gen_clothing` | `{type:object,properties:{id:{type:string},prompt:{type:string},design:{type:object}},required:["id"]}` |
| `get_clothing` | `index:19066` | `gen_clothing` | `{type:object,properties:{id:{type:string}},required:["id"]}` |

That asymmetry is the whole finding: **`send_3d_to_studio` exists, `send_icon_to_studio`
exists, and `send_clothing_to_studio` does not.** It is not an omission in the report — the
registry has exactly 4 `Tl` tools, and `10-tool-surface` §3.7 lists all four.

### 1.5 The generic file / image tools (the plumbing an agent would use)

| Tool | Line | Schema (verbatim) |
|---|---|---|
| `write_file` | `wn:224` | `{type:object,properties:{path:{type:string},content:{type:string}},required:["path","content"]}` |
| `read_file` | `wn:202` | `{type:object,properties:{path:{type:string}},required:["path"]}` |
| `list_files` | `wn:176` | `{type:object,properties:{path:{type:string,description:"Subfolder, relative to the workspace root"}}}` |
| `delete_file` | `wn:272` | `{type:object,properties:{path:{type:string}},required:["path"]}` |
| `read_image` | `wn:302` | `{type:object,properties:{path:{type:string}},required:["path"]}` |
| `slice_image` | `wn:327` | `{type:object,properties:{path:{type:string},columns:{type:number},rows:{type:number},output:{type:string,description:"Folder for the tiles; defaults beside the source"}},required:["path","columns","rows"]}` |
| `resize_image` | `wn:378` | `{type:object,properties:{path:{type:string},output:{type:string},width:{type:number},height:{type:number},crop:{type:object,description:"Region to take, before resizing",properties:{x:{type:number},y:{type:number},width:{type:number},height:{type:number}}}},required:["path"]}` |

`read_image` is the one that turns a path back into an image block:

```js
// wn:312-325
call: async (e, t) => {
  let n = await E(t.path);
  let r = j(await o(n), t.path.endsWith(`.jpg`) || t.path.endsWith(`.jpeg`) ? `image/jpeg` : `image/png`);
  let i = await N(r);
  return {
    result: { path: t.path, width: i.width, height: i.height },
    summary: `Read ${t.path} (${i.width}x${i.height})`,
    image: r
  };
}
```

**`write_file` + `upload_asset` is the only agent-composable upload path RobloxKit has** —
and `write_file` requires a **user confirmation dialog** unless the target is inside one of
nine collection folders (`wn:19`, `wn:99-102`, `wn:240-257`). The confirmation body reads
`` `${e ? `Replaces` : `Creates`} Documents/RobloxKit/${i.path} (${(i.content ?? ``).length} characters).` ``
with a 20,000-character diff.

### 1.6 `image_render` / `image_edit` / `image_atlas` (`Rd`, `index:22205`+)

These write PNG/JPG/WebP **into the workspace** and return an image block. They are the only
generative tools with an explicit output path.

Shared params `Fd` (`index:22157-22167`), verbatim:

```js
save_as: {
  type: `string`,
  description: `Workspace path to write (e.g. images/ghost-seal.png). Default images/<name>.png.`
},
format: {
  type: `string`,
  enum: Qi,          // ['png','jpg','webp']
  description: `png (default; keeps transparency), jpg, webp (lossless)`
}
```

`image_render` full schema:

```js
{
  type: `object`,
  properties: {
    spec: {
      type: `object`,
      description: `The image spec: {width, height, background, seed, layers: [{ops, filters, blend, opacity, mask}], filters, after, frames, output}`
    },
    inputs: {
      type: `object`,
      description: `Workspace images the spec draws, by name: {"photo": "images/photo.png"}; use as {"type": "image", "src": "photo"} or {"image": {"src": "photo"}}`,
      additionalProperties: { type: `string` }
    },
    name: { type: `string`, description: `A short name for the file` },
    save_as: ..., format: ...
  },
  required: [`spec`]
}
```

`image_edit`: `{path (required), ops[], draw[], save_as, format}`.
`image_info`: `{path}` → `RUST:image_info`.
`image_atlas`: `{spec, frames, columns, paths[], name, save_as, format}`.
`image_spec`: `{}` → returns the `image_spec_help` markdown.

`Rd` is gated `studio_tools` and routes `LOCAL + RUST image_render`. **It has nothing to do
with clothing** — clothing uses its own `renderToCanvas` + `toBlob`.

### 1.7 Layer B — Roblox's own Assistant plugin tools (not RobloxKit's, but decisive)

RobloxKit's Studio bridge is a thin wrapper around **Roblox's own `StudioMCP.exe` +
Studio's built-in `Assistant.rbxm`** (`04-studio-bridge` FINDINGS.md §0, after a documented
correction of an earlier wrong verdict). That plugin ships its own image tools, and the
agent can reach them through `studio_call`.

Live-verified `tools/list` (30 tools, `04-studio-bridge` FINDINGS.md:300-306):

```
upload_image, capture_plugin_gui, search_game_tree, script_search, skill, multi_edit,
start_stop_play, get_console_output, user_mouse_input, store_image, http_get,
character_navigation, list_plugin_guis, script_read, get_studio_state, screen_capture,
script_grep, wait_job_finished, generate_procedural_model, segment_mesh, generate_texture,
user_keyboard_input, execute_luau, generate_mesh, subagent, generate_material,
inspect_instance, search_asset, insert_asset, list_roblox_studios
```

#### `upload_image` — the one that actually mints an asset id

Verbatim description (`.omo/roblox-re/03-studiomcp-tool-surface.md:784`, cross-checked
against `assistant_plugin.bin` @ offset 4,665,356):

```text
Upload a batch of images from http server to Roblox Asset Server, returning imagePath to
assetId map, such as {"http://localhost/image.png" : "rbxassetid://12345678",
"https://www.figma.com/api/mcp/asset/6dcff81e-b394-4640-b3b1-123456789" :
"rbxassetid://12345679"}.
```

| param | type | req? | notes |
|---|---|---|---|
| `imagePaths` | `array<string>` | **yes** | An array of image paths to be uploaded. |
| `studio_id` | `string` | **yes** | Selects Roblox Studio instance |

**It requires an http/https URL. It does not accept a local path.** The error string is in
the plugin binary (`Error Upload: ` + the runtime check), and it was observed live:
`{"C:\\...\\royal-cape-shirt.png":"Error Upload: Only http/https URLs are supported"}`.

The plugin's upload implementation, recovered from `assistant_plugin.bin`:

```
tools.uploadImage.searchAssetAsync.Image.items.assetId.asset.assetItem.loadImageAsync
.maxSize.Vector2.new.getUserId.Assistant_.md5..png.pcall.warn.Failed to search asset
.AssetId.AssetType.AssetName.Description*This asset is uploaded by Roblox Assistant
.CreatorId.CreatorType.ContentType..Token.AdditionalParameters.Enum.AssetCreatorType.User
.PublishAsPackage.publishAssetAsync.data.publishImage.imagePaths.rbxassetid://
.Error Upload:
```

So: `loadImageAsync` → `maxSize` check → md5 → `publishImage` → `publishAssetAsync` →
`rbxassetid://<id>`. Description is hard-coded to `This asset is uploaded by Roblox
Assistant.`

#### `store_image` — local path → IMAGEID URI, **no Roblox asset**

Verbatim description (same source, offset 4,638,986):

```text
Load an image from a local file path and return an IMAGEID_<id> URI that can be passed to
other tools (e.g. as attachedImageUri for generate_procedural_model).
Use this tool when you need to convert a local image file into an image URI that other tools accept.
Supported formats: png, jpg, jpeg. Max file size: 5MB.
```

| param | type | req? | notes |
|---|---|---|---|
| `filePath` | `string` | **yes** | Absolute path to a local image file (png, jpg, or jpeg). |
| `studio_id` | `string` | **yes** | Selects Roblox Studio instance |

`store_image` accepts a **local absolute path** but produces an `IMAGEID_<id>` URI — an
opaque handle for other Assistant tools, **not** an `rbxassetid://`. It is not an upload.

#### `insert_asset` — the only thing that puts an asset in the DataModel

Verbatim description (offset 4,388,028):

```text
Inserts an asset into the game by its numeric Roblox asset ID.
Use this tool when you have a specific asset ID to insert directly, rather than searching the Creator Store.
The asset will be loaded, validated, and placed in the scene.
Always provide assetName when you know the name of the asset (e.g. from search results or user request). The inserted instance will be named using assetName - if omitted, it defaults to a generic name.
Supports models, meshes, images/decals, audio, video, animations, and packages.
```

| param | type | req? | notes |
|---|---|---|---|
| `assetId` | `string` | **yes** | Numeric Roblox asset ID to insert. |
| `assetName` | `string` | no | Name for the inserted instance |
| `assetType` | `string` | no | enum: `Model \| Package \| Mesh \| MeshPart \| Image \| Decal \| Audio \| Video \| Animation` |
| `parentPath` | `string` | no | DataModel path; defaults to workspace |
| `studio_id` | `string` | **yes** | Selects Roblox Studio instance |

**The load-bearing sentence, verbatim from the binary:**

> `'Image' and 'Decal' both insert as a Decal instance.`

There is **no `Shirt` in the `assetType` enum.** `insert_asset` cannot make a shirt.

---

## 2. Does RobloxKit write generated images to disk? Where exactly?

**Yes — two different files, in two different places, and neither is what the tool result
points at.**

### 2.1 What `generate_clothing` actually writes

The pipeline (`02-clothing` §0, verified against the bundle):

```
ClothingPanel -> queueNewClothing/queueEditClothing      clothing:381-416
              -> tasks.spawnTask({kind:"clothing"})       tasks-Rr6W1sdh.js:110
              -> handler a("clothing", …)                 clothing:342-355
              -> L() run task                             clothing:278-340
                   -> N(avatarStore()) == clothingBuilder  clothing:213-244
                   -> S({...})         == generate        clothing:84-153
                        -> designLoop  (gen3d-BAdfthxw.js:771)
                             validate -> attachImages -> renderToCanvas -> checkDesign
                             -> returns {design, canvas, report, sheet}
                   -> P(design, canvas) == renderClothingThumbnail   clothing:245-257
                   -> w.save(item, thumbPng)              collection-DAIZY86Y.js:106
```

The save itself, verbatim (`clothing-62l72JIa.js:483`):

```js
await w.save(a, await P(r.design, r.canvas));
```

`w` is the clothing collection, bound at `clothing:172-175`:

```js
var w = s({ root: `clothing/collection`, kind: `clothing` });
```

`save` (`collection-DAIZY86Y.js:106-115`):

```js
async save(t, n) {
  await h(t.id);                                                    // mkdir -p
  await a(await l(`${e}/${t.id}/item.json`), JSON.stringify(t, null, 1));
  if (n) {
    ...
```

`thumbnail` (`collection-DAIZY86Y.js:103-105`):

```js
async thumbnail(t) {
  return n(await l(`${e}/${t}/${id}/thumb.png`));   // readFile -> Uint8Array
},
```

**Exact on-disk layout:**

```
<Documents>/RobloxKit/                       <- workspace root, workspaceTools:17 (_ = "RobloxKit")
└── clothing/
    └── collection/
        └── <itemId>/                        <- m-<b36 ms>-<4 rand>  (collection:26)
            ├── item.json                    <- JSON.stringify(item, null, 1)   (indent 1)
            └── thumb.png                    <- raw PNG bytes, 256x256, transparent
```

`item.json` shape for a clothing item (`clothing-62l72JIa.js:465-482`):

```js
{
  id: d(),                                  // m-<b36 ms>-<4 rand>
  name: e.name || t?.slice(0, 40) || `Untitled design`,
  type: r.design.type,                      // "shirt" | "pants" | "tshirt"
  prompt: t ?? ``,
  createdAt: i,
  updatedAt: i,
  current: 1,
  versions: [{
    prompt: t ?? `Made by hand`,
    design: r.design,                       // the whole design JSON
    ok: r.report.ok,
    brain: n,
    note: null,
    n: 1,
    createdAt: i
  }]
}
```

Note what is **absent**: no PNG path, no asset id, no thumbnail path. The design JSON is
the artifact; `thumb.png` is a sibling file found by convention, not by reference.

The **full-size** 585x559 PNG is *never written by the generation path*. It exists only as
an in-memory `HTMLCanvasElement` (`built.canvas`), and is encoded to bytes only when
`saveClothingPng` is called (`clothing:492-497`):

```js
async function J(e) {
  let t = await (await M()).renderPng(c(e).design);
  return f(`clothing`, {
    [`${q(e)}.png`]: t
  });
}
```

`f` is `writeWorkspaceFiles` = `$` in `roblox-Hg46Sdx8.js:483-500`:

```js
async function $(e, t) {
  let n = await c(e);                      // resolve dir
  if (!(await o(n))) { await s(n, { recursive: true }); }
  let r = [];
  for (let [n, i] of Object.entries(t)) {
    let t = await c(`${e}/${n}`);
    await a(t, i);                         // writeFile raw bytes
    r.push(`${e}/${n}`);
  }
  return { dir: n, files: r };
}
```

So `saveClothingPng` writes:

```
<Documents>/RobloxKit/clothing/<slug>.png
```

where `<slug>` is `q(item)` (`clothing:489-491`):

```js
function q(e) {
  return String(e.name || `clothing`).toLowerCase().replace(/[^a-z0-9_-]+/g, `-`).replace(/^-+|-+$/g, ``).slice(0, 40) || `clothing`;
}
```

**This function is exported (`clothing:512` `J as u`) but is only called from the UI.** The
only caller is the Clothing panel button (`ClothingPanel-CEM_quBl.js:590`):

```jsx
<_Component14 icon={Te} busy={y === `save`} disabled={u}
  onClick={() => O(`save`, async () => `Saved Documents/RobloxKit/${(await pe(e)).files[0]}.`)}>
  {`Save PNG to workspace`}
</_Component14>
```

`pe` is `saveClothingPng` (imported at `ClothingPanel:13` as `u as pe`). **No MCP tool calls
it.** `generate_clothing` does not call it.

### 2.2 The other file: the thumbnail returned as an MCP image block

`generate_clothing`'s return, verbatim (`index-DPVV2ya5.js:18970-18979`):

```js
return {
  result: {
    ...Sl(i),
    task_id: r.id,
    ...wl(i)
  },
  summary: `Designed ${i.name}`,
  image: await xl(i.id)
};
```

`xl` (`index:18860-18866`):

```js
async function xl(e) {
  try {
    return bl(await cr.thumbnail(e));
  } catch {
    return;
  }
}
```

`bl` (`index:18853-18859`) base64-encodes the bytes into a data URL:

```js
function bl(e) {
  let t = ``;
  for (let n = 0; n < e.length; n += 32768) {
    t += String.fromCharCode(...e.subarray(n, n + 32768));
  }
  return `data:image/png;base64,${btoa(t)}`;
}
```

`cr` is the clothing collection (`index:32` `import { a as cr, … } from "./clothing-62l72JIa.js"`).
`cr.thumbnail(id)` reads `<root>/clothing/collection/<id>/thumb.png` off disk.

**So the `image` in the tool result is the 256x256 thumbnail, re-read from disk, base64'd.**
It is not the 585x559 garment.

`Sl` (`index:18867-18879`) builds the JSON result:

```js
function Sl(e) {
  let t = N(e);
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    prompt: e.prompt,
    version: e.current,
    versions: e.versions.length,
    ok: t?.ok,
    updatedAt: e.updatedAt
  };
}
```

`wl` (`index:18889-18891`):

```js
var wl = e => ({
  openInClothing: e.id
});
```

**The full result object is:**

```json
{
  "result": {
    "id": "m-lq3k9x-a1b2",
    "name": "Royal Court Cape",
    "type": "shirt",
    "prompt": "baju kerajaan, dengan jubah",
    "version": 1,
    "versions": 1,
    "ok": true,
    "updatedAt": 1793105141834,
    "task_id": "task-lq3k9x-zz9y",
    "openInClothing": "m-lq3k9x-a1b2"
  },
  "summary": "Designed Royal Court Cape",
  "image": "data:image/png;base64,iVBORw0KGgo…"
}
```

**There is no file path. There is no asset id. There is no data URL of the full garment.**
There is a `data:` URL of the thumbnail, and an item id.

### 2.3 The `design`-bypass path returns no image at all… almost

`generate_clothing` has two paths. The `design` path (`index:18932-18952`) skips the LLM:

```js
if (t.design) {
  let { item: e, built: n } = await ur({
    design: { ...t.design, type: t.type },
    prompt: t.prompt,
    brain: `assistant`
  });
  return {
    result: {
      ...Sl(e),
      report: n.report,
      ...wl(e)
    },
    summary: `Drew ${e.name}`,
    image: await xl(e.id)
  };
}
```

It returns `report` **and** the same thumbnail. The prompt path does not return `report`.

### 2.4 The `media:` store — a third place bytes can live

Separately from the workspace files, RobloxKit has a Rust-backed blob store:

- `media_put` — writes raw bytes, MIME in the `x-mime` header (default `image/png`)
- `media_get` — reads by id, Rust prefixes `"media:"` itself
- `remote_media_file` — exposes a media file over the asset protocol

Keys are `media:<id>`. On disk (reconstructed with **medium** confidence, `09-rust-engines`
§S7.2):

```
<AppData>/<bundle-id>/
├── media/          <- blobs, named by media id, no extension (MIME stored separately)
├── images/         <- image-engine outputs (frontend-chosen)  <slug>.png|jpg|webp
├── downloads/      <- yt-dlp outputs
└── (KV store)      <- "RobloxKitmedia" / "media:<id>" keys
```

**The clothing path does not use it.** `renderClothingThumbnail` returns `Uint8Array`; the
collection writes it with `writeFile`. `media:` is used for chat-attachment persistence
(`11-persistence-state` §7.5: `onToolResult` converts `image` data URLs to `media:` refs,
capped at the last 6). So the thumbnail the model sees *does* end up as a `media:` ref in
the persisted thread — but that is the transcript's copy, not the artifact's.

### 2.5 Summary table — what is on disk after one `generate_clothing`

| Path | Written by | Contents | Referenced by the tool result? |
|---|---|---|---|
| `<Docs>/RobloxKit/clothing/collection/<id>/item.json` | `collection.save` | item + design JSON + versions | **no** (only `id` is echoed) |
| `<Docs>/RobloxKit/clothing/collection/<id>/thumb.png` | `collection.save` | 256x256 PNG, transparent | indirectly — `image` is its base64 |
| `<Docs>/RobloxKit/clothing/<slug>.png` | `saveClothingPng` (UI button only) | 585x559 (512x512 tshirt) PNG | **no** |
| `<AppData>/<bundle>/media/<id>` | `media_put` (chat persistence) | thumbnail bytes | **no** |
| `~/.claude/projects/<slug>/<uuid>/tool-results/mcp-*.png` | **the ACP client, not RobloxKit** | the image block | **no** |

---

## 3. How does the agent (the brain) learn the file path?

**It doesn't. There is no path to learn.** Three separate facts, each verified:

### 3.1 The tool result has no path

The envelope is `{result:{id,name,type,prompt,version,versions,ok,updatedAt,task_id,openInClothing}, summary, image}`.
`openInClothing` is an **item id**, not a path — and it is a UI affordance (it opens the
Clothing panel to that item), not a filesystem handle.

### 3.2 No system prompt tells it

RobloxKit has **three** agent instruction documents, and none of them is in the bundle:

| Document | Bundle | Reaches |
|---|---|---|
| `acp/rules.md` | `acp/system` | ACP agents as `session/new.instructions` |
| `tools/instructions.md` | `tools/catalog` | external MCP clients as `mcp_register.instructions` |
| `prompts/chat.md` | `prompts/chat` | RobloxKit's in-app agent as the system message |

All three are fetched from `https://robloxkit.dev/api/assets/...` behind auth, and **all 12
tested paths returned HTTP 401** (`01-generator-loop` §15; `10-tool-surface` G2/G3/G5). So
the text is unrecoverable. What *is* recoverable is the only structured context block the
agent gets — `sessionContext` (`agentInstructions-DRb-9XyH.js:16-24`):

```js
function l({ studios: e = [], studioId: t, status: n }) {
  let r = e.find(e => e.id === t);
  return [`RobloxKit session context`,
    `- Open place: ${r ? `${r.name} (studio_id ${r.id})` : `none selected`}`,
    `- Studio connection: ${n ?? `unknown`}`,
    `- Other Studio windows: ${e.filter(e => e.id !== t).map(e => e.name).join(`, `) || `none`}`,
    `- Skills to read first: roblox-performance; then the one for the task (${i().join(`, `)})`,
    `- Studio and workspace tools are on the \`robloxkit\` MCP server.`].join(`\n`);
}
```

**It names the place, the connection, the other windows, the skills and the MCP server. It
says nothing about where artifacts are written.** There is no upload instruction, no
dashboard URL, no path template.

### 3.3 The dashboard URL is UI-only, not agent-visible

`UPLOAD_GUIDE` (`clothing-62l72JIa.js:498-511`, exported as `t`, `clothing:512`):

```js
var Y = {
  shirt:  { label: `Classic Shirts`, url: `https://create.roblox.com/dashboard/creations?activeTab=Shirt` },
  pants:  { label: `Classic Pants`,  url: `https://create.roblox.com/dashboard/creations?activeTab=Pants` },
  tshirt: { label: `T-Shirts`,       url: `https://create.roblox.com/dashboard/creations?activeTab=TShirt` }
};
```

**It is consumed only by `ClothingPanel-CEM_quBl.js:403` (`let D = fe[e.type]`), to render the
*Use it* section.** A full-tree grep across all 166 bundles finds `UPLOAD_GUIDE` only at its
own definition (`clothing:155`) — nothing else imports it. It is not in any tool result, not
in any prompt, not in the `tools/catalog.json` description (descriptions come from the
server, `10-tool-surface` §2.4).

### 3.4 So how *would* an agent discover the path?

Only by reasoning about convention, or by `list_files`:

1. `list_files {path: "clothing/collection"}` → directories named `m-…`
2. `list_files {path: "clothing/collection/m-…"}` → `item.json`, `thumb.png`
3. `read_file {path: "clothing/collection/m-…/item.json"}` → the design
4. `read_image {path: "clothing/collection/m-…/thumb.png"}` → a 256x256 image block

That is a **4-call discovery with no prompt telling it to try**, and step 4 gives it the
thumbnail, not the garment. The only way to get the *full-size* PNG onto disk is
`saveClothingPng` — which no tool exposes.

**Verdict: the agent has to discover the path, and the path it can discover is the wrong
file.** The report says this outright in the port's own words
(`porting/04-tools` §4.5): *"A port that returns only the spec gives the agent nothing to
look at. Return all three."* — all three being `result`, `summary`, `image`.

---

## 4. The happy path: "generated PNG" → "shirt visible on the avatar in Studio"

### 4.1 What the reports contain

**There is no trace of that sequence anywhere in the corpus, because RobloxKit does not do
it.** Searches that return zero:

| Search | Result |
|---|---|
| `ShirtTemplate` across all 166 frontend bundles | **0 hits** |
| `PantsTemplate` across all 166 frontend bundles | **0 hits** |
| `Instance.new("Shirt"` / ``Instance.new(`Shirt` `` | **0 hits** |
| `:Shirt` | **0 hits** |
| `create_shirt` / `upload_clothing` / `send_clothing_to_studio` | **0 hits** |
| `send_clothing*` in the 94-tool registry | **0 hits** (`Tl` has exactly 4 tools) |

(`ShirtTemplate` *does* appear exactly once in `assistant_plugin.bin` @ 19,662,152 — but as
a member of Roblox's serialised property-name table
(`Clothing.PantsTemplate.Pants.ShirtTemplate.Shirt.Graphic.ShirtGraphic`), i.e. Roblox's own
class metadata, not a code path anyone in this corpus writes.)

### 4.2 The sequence RobloxKit actually implements

```
1. agent:  generate_clothing {type:"shirt", prompt:"baju kerajaan, dengan jubah"}
2. SPA:    spawnTask(kind:"clothing")                     tasks-Rr6W1sdh.js:110
3. loop:   designing -> building -> checking -> fixing    clothing:272-277
4. build:  validateDesign -> attachImages -> renderToCanvas (585x559)
           -> checkDesign -> renderClothingSheet (1024x358 JPEG, vision only)
5. persist: collection.save(item, thumbnailPng)
           -> Documents/RobloxKit/clothing/collection/<id>/{item.json,thumb.png}
6. return: {result:{id,…}, summary:"Designed <name>", image:"data:image/png;base64,…"}
           -> MCP: [{type:"text", text:"<JSON>"}, {type:"image", mimeType:"image/png", data:"…"}]
7. HUMAN:  opens the Clothing panel -> "Use it" section
8. HUMAN:  clicks "Save PNG to workspace"
           -> Documents/RobloxKit/clothing/<slug>.png
9. HUMAN:  clicks "Open Creator Dashboard"
           -> https://create.roblox.com/dashboard/creations?activeTab=Shirt
10. HUMAN: uploads the PNG in the browser, names it, pays the upload fee
11. HUMAN: Roblox reviews it, sets a price, puts it on sale
12. HUMAN: wears it / inserts a Shirt instance with ShirtTemplate = "rbxassetid://<id>"
```

Steps 7–12 are the panel's own copy, verbatim (`ClothingPanel-CEM_quBl.js:590`):

> *Use it* — hint: `Roblox does not let apps publish classic clothing: the upload is yours.`
>
> 1. `Save the PNG.`
> 2. `In the Creator Dashboard open Avatar Items → ` + `{D.label}` + `.`
> 3. `Upload the PNG, name it, and pay the upload fee` + `(t-shirts are free to upload)`
> 4. `Roblox reviews it; then set a price and put it on sale.`

**The agent's involvement ends at step 6.** The pipeline's `Upload` row reads literally
`by you` (`ClothingPanel:67`: `` <T rows={[[…], [`Upload`, `by you`]]} /> ``).

### 4.3 The sequence that *would* work, assembled from the corpus

This is the closest thing to a trace, and it is a construction — every step cites a real
tool with a real schema, but **no report documents this being run end-to-end**.

```
1. generate_clothing {type:"shirt", prompt:"…"}                 -> item id + thumbnail data URL
2. write_file {path:"clothing/<slug>.png", content:"<base64 or raw>"}   <- BLOCKED: content is a string, and
                                                                          there is no PNG->string path exposed.
                                                                          Also triggers a confirm dialog.
   (or) UI: Save PNG to workspace  -> Documents/RobloxKit/clothing/<slug>.png
3. upload_asset {path:"clothing/<slug>.png", name:"…", type:"image"}
      -> POST robloxkit.dev/api/roblox/upload  {type:"image",filename,name,description,data:<base64>}
      -> {asset_id}  or  {operation_id, moderation_note}
4. asset_status {operation_id}                                  -> {done:true, asset_id}
5. execute_luau {datamodel_type:"Edit", code: <Luau that sets ShirtTemplate>}
```

Step 5 has **no reference implementation in the corpus**. Nothing emits
`ShirtTemplate`. The nearest analogues are the four `image(id)` helpers, which all resolve a
Decal to its texture URL:

```lua
-- icons-BpUOWggy.js:414-423, identical in textures-Dx9L9-nO.js:2863-2872 and index:19472-19481
local function image(id)
  local ok, loaded = pcall(function() return InsertService:LoadAsset(id) end)
  if ok and loaded then
    local decal = loaded:FindFirstChildWhichIsA("Decal", true)
    local tex = decal and decal.Texture
    loaded:Destroy()
    if tex and tex ~= "" then return tex end
  end
  return "rbxassetid://" .. id
end
```

The comment on that pattern is the answer to Q5 (`03-textures-skybox` §behaviour notes):

> `image(id)` resolves a **decal asset id → texture URL** via `InsertService:LoadAsset`,
> because `MaterialVariant.ColorMap` needs an `rbxassetid://` *image* and the upload API
> returns a Decal/Image asset id. Falls back to `rbxassetid://{id}`.

### 4.4 The one observed real-world trace (Termul, not RobloxKit)

The nearest thing to a live trace is in the Termul evidence, and it is a *failure* trace
(`.omo/roblox-fix/04-termul-harness-and-upload-bugs.md:23, :486, :618`):

```
agent finds ~/.claude/projects/<slug>/<uuid>/tool-results/mcp-termul-blob-*.png
  -> starts `python -m http.server 8765`
  -> Studio MCP upload_image(["http://localhost:8765/….png"], studio_id)
  -> {"http://localhost:8765/…":"rbxassetid://81011940726608"}
  -> guesses Shirt vs Decal vs ShirtTemplate
  -> tries start_stop_play + screen_capture, gets a blank frame, loops
  -> eventually: execute_luau creating a Shirt with ShirtTemplate = "rbxassetid://81011940726608"
     in StarterPack, then applying it to the character at runtime
  -> 5m05s, "needs attention"
```

Note the shape: `upload_image` needed an **http URL**, which is why the detour existed. The
error was `Error Upload: Only http/https URLs are supported`.

---

## 5. Decal/Image → `ShirtTemplate`, or a real Shirt asset?

### 5.1 What the reports say

**RobloxKit uploads images as `type: "image"`, and the server returns a Decal.** Verified
three ways:

**(a) The UI says so, verbatim** (`UploaderPanel-DBEbMiEj.js:122-125`):

```js
W(n.asset_id ? {
  tone: `ok`,
  text: `Uploaded as asset ${n.asset_id}${F === `image` ? ` (a Decal)` : ``}.`,
  assetId: n.asset_id
} : { … });
```

**(b) Every upload call site passes `type: 'image'`:**

| Call site | Type | What it becomes |
|---|---|---|
| `wn:459` `upload_asset` | `t.type ?? A(t.path)` → `"image"` for `.png` | a Decal |
| `gfx-CVkb5YLh.js:541` `upload_gfx` | `type: 'image'` | a Decal |
| `icons-BpUOWggy.js:380` | `type: 'image'` | a Decal |
| `textures-Dx9L9-nO.js:2831` | `type: 'image'` | a Decal |
| `generator-BkAchkKU.js` `send_3d_to_studio` | `type: 'model'` | a Model |

The `uploadType` map has exactly four keys (`wn:130`): `["image","audio","video","model"]`.
**There is no `"shirt"` type, no `"pants"` type, no `"tshirt"` type.** The word `Shirt` does
not appear in the upload type vocabulary at all.

**(c) The Luau resolvers exist precisely because an image upload is a Decal.** Three separate
emitters (`icons-BpUOWggy.js:414`, `textures-Dx9L9-nO.js:2863`, `index:19472`) carry an
identical `image(id)` helper that `InsertService:LoadAsset`s the id, digs out
`FindFirstChildWhichIsA("Decal", true).Texture`, and uses *that* URL — with a documented
fallback to `rbxassetid://{id}`.

**(d) Roblox's own `insert_asset` confirms it from the other side.** Verbatim from
`assistant_plugin.bin`:

> `'Image' and 'Decal' both insert as a Decal instance.`

And the `assetType` enum has no `Shirt` member:
`Model | Package | Mesh | MeshPart | Image | Decal | Audio | Video | Animation`.

### 5.2 So: does RobloxKit set `ShirtTemplate = "rbxassetid://ID"`?

**No.** Zero occurrences of `ShirtTemplate` or `PantsTemplate` in all 166 bundles. RobloxKit
does not insert shirts, and it has no tool that would.

### 5.3 Moderation / asset-type constraints, as stated

| Constraint | Evidence |
|---|---|
| **Classic clothing cannot be published by an app.** | `ClothingPanel:590`: *"Roblox does not let apps publish classic clothing: the upload is yours."* |
| Upload is **asynchronous** when moderated. | `POST /api/roblox/upload` answers `{asset_id}` (done) **or** `{operation_id}` (queued). `roblox:320-328` |
| Poll cadence | **2 s**, **120 s** budget. `waitForUpload`, `roblox:354-374` |
| Failure surfaces `moderation_note` | Every call site: ``throw Error(c.moderation_note ?? `Roblox has not finished processing …`)`` |
| Default message when no note | `'Roblox accepted the upload and is still processing it. It will appear in your inventory when it is done.'` (`UploaderPanel:128`) |
| Image uploads become **Decals** | `UploaderPanel:124` |
| Uploads are **base64 inside JSON**, not multipart | `roblox-Hg46Sdx8.js:299-313`. **Contradiction:** `07-roblox-integration/FINDINGS-API-CONTRACT.md:42` labels `/api/roblox/upload` as "(multipart)". The bundle wins — `Content-Type: application/json` + `data: x(a)` where `x` is `toBase64`. The only multipart in the whole layer is place publishing (`index:23092-23113`). |
| Size caps are **server-declared** | `GET /api/roblox/upload/types` → `{types:[{key,label,max_mb,extensions[]}]}`; client fallback `max_mb = video ? 100 : 20` (`UploaderPanel:22`) |
| `upload_asset` **skips** the size check | `11-persistence-state` §6.3: the agent path "does **not** apply the `max_mb` check, does **not** send `group_id`, does **not** record the asset in `assets.json`" |
| Classic-clothing upload costs money | `ClothingPanel:590`: "pay the upload fee" + "t-shirts are free to upload" |
| Open Use is permanent for images | `OPEN_USE_TYPES = ['Image','Decal','Mesh']` (`assets:320`); `OPEN_USE_IS_PERMANENT` |
| A `Universe` grant is permanent | `assets:275`: *"Roblox does not let a permission given to an experience be taken back: it is permanent."* |

---

## 6. Mistakes the reports warn about

### 6.1 "Needing a local HTTP server" — the biggest one

`upload_image` **requires an http/https URL**, not a path. Observed error:
`Error Upload: Only http/https URLs are supported`. The Termul evidence calls the
`python -m http.server 8765` detour *"not confusion - it was the only route to a URL"*
(`04-termul-harness-and-upload-bugs.md:489`). Any design that hands an agent a local PNG path
and says "upload it with `upload_image`" is broken by construction.

### 6.2 "Needing the plugin"

RobloxKit's Studio path requires **Roblox Studio's own MCP server enabled in Assistant
settings**. Without it (`04-studio-bridge` FINDINGS.md:297-299):

- `list_roblox_studios` returns `{"studios":[]}` indefinitely
- The proxy errors: `"No Roblox Studio instances are connected. Ask the user to confirm that
  Studio is running with a place open and the MCP server enabled in Assistant settings."`
- `"No tools available, waiting for ws_server to push tools..."` then
  `"Timed out waiting for tools to become available"`

And **every** `studio_call` needs a `studio_id`:
`"This call is missing the required \`studio_id\` argument. Call \`list_roblox_studios\` to get
the connected instance ids, then include \`studio_id\` on every tool call."`

`execute_luau` additionally **requires** `datamodel_type`:
`execute_luau` without it → `isError: "datamodel_type is required"`. Enum
`Edit|Client|Server`. *"Any rebuild relaying `studio_call` must pass it."*

### 6.3 Path restrictions

`resolvePath` (`wn:103-120`) rejects, in order:

1. any segment equal to `..` — **after NFKC normalisation**, so Unicode look-alikes fail too
2. absolute paths and Windows drive prefixes (`/^[a-z]:/i`)
3. per-segment guard (`wn:71-98`): invisible/control codepoints, `:`, empty-after-fold,
   **anything starting with a dot**, eight protected instruction filenames
   (`claude.md`, `claude.local.md`, `agents.md`, `agents.override.md`, `agent.md`,
   `gemini.md`, `copilot-instructions.md`, `mcp.json`), and `/^[^.]{1,6}~\d/` (8.3 short names)
4. join, dropping empty and `.` segments

The homoglyph fold (`wn:25-70`) maps 29 Cyrillic/Greek look-alikes to Latin and 10 exotic
dots to `.` **before** the denylist comparison, and strips trailing dots/spaces (the Windows
"trailing dot" trick).

`write_file` **always confirms** unless the path is inside one of nine collection roots
(`wn:19`): `3d/collection`, `clothing/collection`, `vfx/collection`, `gfx/collection`,
`icons/collection`, `sfx/collection`, `skybox/collection`, `textures/collection`,
`music/collection`. Note `cutscene/collection` and `animation/collection` are **not** in that
list — an inconsistency that makes writes there prompt unexpectedly
(`11-persistence-state` §1.1C).

`delete_file` has **no** exemption: *"does not go to the Trash"*, always confirms.

### 6.4 Asset type must be `image`, and it becomes a Decal

There is no `Shirt` asset type anywhere in RobloxKit's vocabulary. If you want a real Shirt
asset you must go through the Creator Dashboard (the `UPLOAD_GUIDE` links), because
*"Roblox does not let apps publish classic clothing."*

### 6.5 Do not confuse the three bridges

`04-studio-bridge` FINDINGS.md §0 exists entirely to correct this:

| Bridge | Port | Token | On RobloxKit's path? |
|---|---|---|---|
| `StudioMCP.exe` + Studio's `Assistant.rbxm` | WS `127.0.0.1:13469` | none | **yes** |
| `@chrrxs/robloxstudio-mcp` | Node `:58741` + `/ready` + WS | `X-Studio-Token` | **no** |

The chrrxs plugin is documented in the corpus for reference only. Its route map
(`/api/insert-asset`, `/api/preview-asset`) is *not* RobloxKit's.

### 6.6 Do not trust `_TOOLFEATURES.txt` or the "85/86/93" counts

Five different tool counts appear in prior artifacts. `10-tool-surface` §1 reconciles them:
**94** registered, **91** gated/visible, **3** ungated (`set_music_mixer`, `ytdl_info`,
`ytdl_download`), **93** naive-literal (misses the `plan_teleport` push), **86** stale
(`_TOOLFEATURES.txt` silently dropped the whole `gen_3d` group), **85** index-only (misses
the 9 `workspaceTools` tools).

### 6.7 The `image` field must be a `data:` URL or it is silently dropped

`fO` (`index:42151-42202`):

```js
let l = s && /^data:([^;]+);base64,(.*)$/s.exec(s);
if (l) c.push({ type:`image`, mimeType: l[1], data: l[2] });
```

Anything else — a bare path, a `media:` ref, an `rbxassetid://` — produces **no image
block and no error**. And 22 of the 94 tools set `image`, each via a thumbnail helper that is
`try/catch`ed and returns `undefined` on failure, so a missing thumbnail degrades silently to
a text-only reply.

### 6.8 `upload_asset` returns no `image` key

It returns `{result, summary}` only. An agent that uploads gets JSON, not a picture, and must
call `read_image` separately if it wants to look at what it uploaded.

---

## 7. Pre-existing artifact/blob store on disk

### 7.1 Yes — but it is the ACP client's, not RobloxKit's and not Termul's

**Verified present on this machine** (3 files):

```
C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\888892cf-4d41-478b-9cbc-1bc46811a99c\tool-results\mcp-termul-blob-1793105141834-y4lek2.png   (46,871 B)
C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\d92e9044-6a4e-4a46-afdc-ad5c8e3b6e0c\tool-results\mcp-termul-blob-1793103911249-lk6u93.png   ( 8,902 B)
C:\Users\Novella\.claude\projects\C--Users-Novella-Documents-RobloxKit\d92e9044-6a4e-4a46-afdc-ad5c8e3b6e0c\tool-results\mcp-termul-blob-1793103914689-jq0oyb.png   (66,992 B)
```

**Provenance, proved three ways** (`.omo/roblox-fix/04-termul-harness-and-upload-bugs.md` §4.1):

1. A repo-wide grep for `blob` in `src-tauri` finds only unrelated hits (git blob hashes,
   `blob:` URL parsing, SSH key blobs). `tool-results`, `mcp-termul-blob` and `blob-17.`
   match **nothing** in `src-tauri` or `src/renderer`. **Verified again for this document:**
   `grep -r "tool-results"` and `grep -r "mcp-termul-blob"` over `termul/src` → **0 matches**.
2. The naming is the **client's**: `mcp-<server>-blob-<epoch-ms>-<rand>.<ext>`, and the same
   directory holds `mcp-roblox-studio-blob-1793105239514-837jql.jpg` from the *other* MCP
   server. One naming scheme, two servers ⇒ it belongs to the client.
3. The transcript shows the substitution verbatim:

   ```
   content[1] = { type: "text", text: "[Image: source: C:\\Users\\Novella\\.claude\\projects\\C--Users-Novella-Documents-robloxkit\\888892cf-.\\tool-results\\mcp-termul-blob-1793105141834-y4lek2.png]" }
   ```

**Claude Code materialises an MCP `image` content block to disk and replaces it in the
transcript with a text placeholder.** The path is outside the project cwd, and neither
RobloxKit nor Termul knows or controls it.

**Latent bug worth noting:** the placeholder **lowercases** the project slug
(`...-robloxkit`) while the directory on disk is `...-RobloxKit`. It works only because NTFS
is case-insensitive. On a case-sensitive filesystem that path would not resolve.

### 7.2 RobloxKit's own artifact stores (three, all different)

| Store | Location | Key | Written by |
|---|---|---|---|
| **Collections** | `<Docs>/RobloxKit/<kind>/collection/<id>/{item.json,thumb.png}` | item id `m-<b36ms>-<4rand>` | `collection.save` |
| **Media** | `<AppData>/<bundle>/media/<id>` | `media:<id>` | Rust `media_put` (raw bytes + `x-mime`) |
| **KV stores** | `%APPDATA%\dev.robloxkit.desktop\` | per-file | `tauri-plugin-store` / `kv_*` |

Plus, for completeness: `assets.json:uploads` (≤500 `UploadRecord`s), `tasks.json` (60
finished), `threads.json`, `settings.json`, `auth.json` — and localStorage keys
`robloxkit-uploads` (≤50, a **different shape** with `asset_id` not `assetId`) and
`robloxkit-downloads` (≤50).

### 7.3 What a port should learn from this

The blob is a **client side effect**, not a contract. Building a workflow on it is building
on an implementation detail of one specific ACP client, at a path that a) is outside the
project, b) requires NTFS case-insensitivity to resolve from the placeholder, and c) is
garbage-collected on the client's schedule. The `04-termul-harness-and-upload-bugs.md`
verdict is blunt: *"Termul writes no artifact file"* and the blob *"is a side effect of the
client"*.

---

## 8. What a faithful port must do — checklist

**Upload / insertion surface**

- [ ] **Do not invent an upload path RobloxKit does not have.** RobloxKit's clothing flow
      ends at "PNG on disk + a dashboard URL". Anything more is a new feature, and must be
      labelled as one.
- [ ] If you port an upload at all, port `upload_asset` **verbatim**: `{path, name,
      description?, type?}` with `path` **workspace-relative**, `type` inferred from the
      extension against `{image:[png,jpg,jpeg,bmp,tga,webp,gif], audio:[mp3,ogg,wav,flac],
      video:[mp4,mov,webm], model:[fbx,obj,gltf,glb,rbxm,rbxmx]}`, body
      `{type,filename,name,description,data:<base64>}` as **JSON, not multipart**.
- [ ] Port `asset_status {operation_id}` and the **2 s / 120 s** poll.
- [ ] Keep the `(a Decal)` fact in the result summary — `Uploaded as asset <id> (a Decal)`
      when the type is `image`. It is the only signal that the asset is not a Shirt.
- [ ] Port `UPLOAD_GUIDE` verbatim into whatever the agent can read:
      `shirt → https://create.roblox.com/dashboard/creations?activeTab=Shirt`,
      `pants → …?activeTab=Pants`, `tshirt → …?activeTab=TShirt`.
- [ ] Carry the reason: *"Roblox does not let apps publish classic clothing: the upload is
      yours."* Without it the agent will keep looking for an API that does not exist.
- [ ] State the `Shirt`/`Decal` distinction explicitly: an image upload is a **Decal**;
      a wearable shirt is a **`Shirt` instance with `ShirtTemplate = "rbxassetid://<id>"`**;
      and getting a *Shirt asset id* requires the Creator Dashboard.

**Artifacts on disk**

- [ ] Write `item.json` + `thumb.png` per artifact at
      `<workspace>/<kind>/collection/<id>/{item.json,thumb.png}`; `item.json` indented **1**;
      id = `m-<Date.now().toString(36)>-<4 rand base36>`.
- [ ] Keep the version list (`versions[]` with `{n, createdAt, …}` + a `current` pointer).
      `edit_clothing` depends on it; overwriting loses history.
- [ ] Also write the **full-size** PNG at a deterministic path (`clothing/<slug>.png`,
      slug = `q(item)`), because RobloxKit's `saveClothingPng` does — and because that is the
      file the user actually uploads.
- [ ] Make the thumbnail **256x256 transparent PNG** (`renderClothingThumbnail`), and the
      garment **585x559** (`512x512` for t-shirts).

**The result envelope**

- [ ] Return all three: `result` (JSON), `summary` (one line), `image` (**a `data:` URL or
      nothing** — anything else is silently dropped by the MCP serialiser).
- [ ] Put the **absolute path** of the written PNG in `result` (e.g. `file`), because
      RobloxKit does not and that is exactly the gap that cost a five-minute detour. This is
      an improvement, not a fidelity requirement — say so.
- [ ] Cap the text at **6000 chars** with the `[truncated: N more characters. Narrow the
      query — …]` notice.

**Tooling / transport**

- [ ] `execute_luau` must work before anything can be inserted: **8 of the 18 Studio-touching
      tools** go through it, and it **requires `datamodel_type`** (`Edit|Client|Server`).
- [ ] Every `studio_call` needs a `studio_id`; call `list_roblox_studios` first.
- [ ] Preserve the per-studio serialising queue (`studioCall-DEchKzj8.js:4-11`) so one
      window never sees overlapping RPCs.
- [ ] Keep `upload_image`'s http-only constraint in mind: it takes `imagePaths:
      array<string>` of **URLs**, not paths. If you offer it to an agent, you must also
      offer a URL.

**Path safety**

- [ ] Reproduce `resolvePath` **verbatim**: `..` after NFKC, absolute/drive rejection,
      the 6 per-segment rules, the 39-entry homoglyph fold, the 8 protected filenames, and the
      8.3 short-name heuristic.
- [ ] Keep the nine-folder `write_file` exemption and the 20,000-char diff dialog everywhere
      else; keep `delete_file` always-confirming.

---

## 9. What the current Termul behaviour gets wrong

Based only on what the reports say RobloxKit does.

### 9.1 Termul has no upload tool at all

A grep for `upload` across `src-tauri/src/acp/host_mcp/` returns **exactly one hit**, and it
is a *description of the other server's tools* (`roblox/instructions.rs:20`). Termul's own
surface is `plan`, `set_session_title`, `read_canvas_guide`, `get_canvas_style`, `ask_user`,
`get_info`, the canvas tools, `browser`, and the `generate_*`/`get_*_task` pairs.
**No upload, no asset-publish, nothing that serves an artifact over HTTP.**

RobloxKit at least has `upload_asset` + `asset_status` + `upload_gfx` + the four
`send_*_to_studio` tools. Termul has none of them.

### 9.2 Termul forbids writing the file, then denies a file exists

`generator_tools.rs:33-46` (`GENERATOR_GUIDE`):

> *"Do not write .lua files, .obj files or image files to disk to stand in for an asset […]
> these tools produce the artifact and hand it back."*

`generator_tools.rs:169-171`:

> *"Nothing is written to disk, so do not search the filesystem for an output file."*

Both statements are true and both are a dead end: the agent is forbidden from writing a
file, given no file, and given no URL. **RobloxKit writes the PNG** — `saveClothingPng` →
`Documents/RobloxKit/clothing/<slug>.png` — and the panel tells the user
`Saved Documents/RobloxKit/${files[0]}.` Termul writes nothing and tells the agent nothing
exists.

### 9.3 Termul's generator envelope has no path, and the model is told it has a `data:` URL

`generator_tools.rs:167-168` says `image` is a `data:image/png;base64` URL you can show.
But the child process **strips `image` out of the JSON and converts it into an MCP image
block**, so the model sees a picture *and* a JSON object with no `image` key. The observed
model reasoning was: *"guessed the result contained base64 data. I can't easily access the
base64 in a file."*

RobloxKit has the same split (JSON in the `text` block, image in a separate `image` block)
but at least returns a stable `id` the agent can act on (`get_clothing`, `openInClothing`).
Termul returns `report` + `layout` + an image block, and no id-and-path pair.

### 9.4 Termul never surfaces the completion step

`build.ts:83-96` returns `report` (size/coverage/colours) and `layout` (region list) only —
**no mention of `ShirtTemplate`, asset ids, `Shirt` vs `Decal`, or where a `Shirt` belongs.**
`GENERATOR_GUIDE` says the tools "produce the artifact and hand it back" but says nothing
about installing it.

RobloxKit does not solve this either — but RobloxKit at least ships `UPLOAD_GUIDE` with the
three dashboard URLs and the sentence *"Roblox does not let apps publish classic clothing:
the upload is yours."* That sentence is the whole answer, and Termul has no equivalent.

### 9.5 Termul's agent burned 5m05s inventing the path RobloxKit documents

The observed loop: find the client's blob → `python -m http.server 8765` → `upload_image`
with a localhost URL → `rbxassetid://81011940726608` → guess Shirt vs Decal vs ShirtTemplate →
`start_stop_play` + `screen_capture` → blank frame → loop.

Every step of that is a symptom of §9.1–9.4. The detour was *correct* given the tools
available; it was expensive because nothing told the agent:
- that `upload_image` needs an http URL (so a URL must be provided, not improvised),
- that the result is a **Decal**,
- that a shirt is a **`Shirt` instance with `ShirtTemplate`**,
- and that the dashboard is the sanctioned route for a *real* Shirt asset.

### 9.6 Termul's blob dependency is an accident, not a contract

The `mcp-termul-blob-*.png` the agent found is written by **Claude Code**, not Termul
(§7.1). It lives outside the project cwd, its path resolves only because NTFS is
case-insensitive, and it is the client's to garbage-collect. Building the upload workflow on
it means the workflow breaks on macOS/Linux and on any client that does not materialise
image blocks.

RobloxKit's equivalent is a **deterministic, project-local** path
(`Documents/RobloxKit/clothing/<slug>.png`) plus a **stable dashboard URL**. That is
portable; the blob is not.

### 9.7 Termul's tool count and gates are not the issue — its *surface* is

RobloxKit has 94 tools, 91 visible, 14 gate keys, and `write_roblox` as the only
plan-differentiating gate. Termul has no plans, so gating is a non-issue. The gap is not
count — it is that the one tool family that matters for "get it into Roblox" (upload +
status + insert) does not exist on Termul's side, and the artifact is deliberately
withheld from disk.

---

## Appendix A — every file:line cited in this document

| Claim | Cite |
|---|---|
| `upload_asset` schema + body | `workspaceTools-oYxH4nqo.js:437-488` |
| `asset_status` | `workspaceTools-oYxH4nqo.js:490-514` |
| upload type map | `workspaceTools-oYxH4nqo.js:130-144` |
| `resolvePath` guard | `workspaceTools-oYxH4nqo.js:103-120` |
| per-segment guard | `workspaceTools-oYxH4nqo.js:71-98` |
| homoglyph fold | `workspaceTools-oYxH4nqo.js:25-70` |
| protected filenames | `workspaceTools-oYxH4nqo.js:18` |
| collection exemption list | `workspaceTools-oYxH4nqo.js:19`, `99-102` |
| workspace root `"RobloxKit"` | `workspaceTools-oYxH4nqo.js:17` |
| `write_file` confirm | `workspaceTools-oYxH4nqo.js:237-270` |
| `read_image` | `workspaceTools-oYxH4nqo.js:302-325` |
| `upload_asset` tool in registry | `10-tool-surface` §3.5 (`wn:437`) |
| clothing group schemas | `10-tool-surface` §3.7 (`index:18893`–`19066`) |
| `generate_clothing` body | `index-DPVV2ya5.js:18931-18980` |
| `Sl` / `wl` / `xl` / `bl` | `index-DPVV2ya5.js:18853-18891` |
| MCP serialiser (`data:` gate) | `index-DPVV2ya5.js:42151-42202` (`10-tool-surface` §5.2) |
| `image`-returning tools (22) | `10-tool-surface` §5.2b |
| `image_render` / `Fd` params | `index-DPVV2ya5.js:22157-22167`, `22205` |
| `saveClothingPng` | `clothing-62l72JIa.js:489-497` |
| `UPLOAD_GUIDE` | `clothing-62l72JIa.js:498-511`, exported `512` |
| clothing collection root | `clothing-62l72JIa.js:172-175` |
| item record | `clothing-62l72JIa.js:465-482` |
| thumbnail write | `clothing-62l72JIa.js:245-257`, `483` |
| `writeWorkspaceFiles` | `roblox-Hg46Sdx8.js:483-500` |
| `uploadAsset` wrapper | `roblox-Hg46Sdx8.js:270-288`, `290-329` |
| `waitForUpload` 2s/120s | `roblox-Hg46Sdx8.js:354-374` |
| `(a Decal)` message | `UploaderPanel-DBEbMiEj.js:122-129` |
| panel "Use it" copy | `ClothingPanel-CEM_quBl.js:590` |
| panel `UPLOAD_GUIDE` use | `ClothingPanel-CEM_quBl.js:403` |
| `collection.save` / `thumbnail` | `collection-DAIZY86Y.js:103-115` |
| item id format | `collection-DAIZY86Y.js:26` |
| icon upload + Luau `image(id)` | `icons-BpUOWggy.js:378-398`, `407-423`, `470-488` |
| texture upload + `image(id)` | `textures-Dx9L9-nO.js:2815-2845`, `2863-2872` |
| gfx upload | `gfx-CVkb5YLh.js:541` |
| `image(id)` in VFX | `index-DPVV2ya5.js:19472-19482` |
| Assistant `upload_image` | `assistant_plugin.bin` @ 4,665,356; `.omo/roblox-re/03-studiomcp-tool-surface.md:775-792` |
| Assistant `store_image` | `assistant_plugin.bin` @ 4,638,986; same md `:794-813` |
| Assistant `insert_asset` + "both insert as a Decal" | `assistant_plugin.bin` @ 4,388,028; same md `:875-899` |
| 30-tool `tools/list` | `re/04-studio-bridge/FINDINGS.md:300-306` |
| `studio_id` / `datamodel_type` errors | `re/04-studio-bridge/FINDINGS.md:307-310` |
| two bridges, only one on-path | `re/04-studio-bridge/FINDINGS.md` §0 |
| `/api/roblox/*` contract | `re/07-roblox-integration/FINDINGS-API-CONTRACT.md` §2 |
| base64-in-JSON (vs "multipart") | `11-persistence-state` §6.1 vs `FINDINGS-API-CONTRACT.md:42` |
| media store | `11-persistence-state` §7; `09-rust-engines` §S7 |
| collection layout + item schema | `11-persistence-state` §4.1-4.2 |
| session context block | `agentInstructions-DRb-9XyH.js:16-24` |
| three instruction documents | `10-tool-surface` §9.6 |
| 12 asset paths → 401 | `01-generator-loop` §15; `10-tool-surface` G2/G3/G5 |
| tool-count reconciliation | `10-tool-surface` §1 |
| gate table (14 keys, 91 tools) | `10-tool-surface` §4.1, Appendix B |
| Termul `GENERATOR_GUIDE` | `termul/src-tauri/src/acp/host_mcp/generator_tools.rs:33-46` |
| Termul "Nothing is written to disk" | `generator_tools.rs:169-171` |
| Termul blob provenance | `.omo/roblox-fix/04-termul-harness-and-upload-bugs.md` §4.1 |
| Termul 5m05s trace | same doc, `:23`, `:486`, `:489`, `:618` |

## Appendix B — corpus gaps this document had to work around

1. **`re/full-reverse/12-studio-bridge-acp/REPORT.md` does not exist.** The directory is
   empty. Studio-bridge material was sourced from `re/04-studio-bridge/` instead.
2. **`prompts/clothing.md` is unrecoverable** — auth-gated, HTTP 401 on every path
   (`01-generator-loop` G1). What the agent was told about uploading is therefore unknown;
   this document infers it from the tool surface and the UI, and says so.
3. **`tools/instructions.md`, `acp/rules.md`, `prompts/chat.md`** — same, all server-side.
4. **No end-to-end trace of a clothing upload exists in the corpus**, because RobloxKit does
   not perform one. §4.2 is the implemented sequence; §4.3 is an assembled construction
   explicitly labelled as such; §4.4 is the only observed trace and it is Termul's failure.
5. **`ShirtTemplate` in `assistant_plugin.bin`** appears only inside Roblox's serialised
   property-name table, not in any script. It is not evidence of a shirt-insertion code path.

## Appendix C — reproduce

```powershell
# 1. ShirtTemplate / PantsTemplate are absent from the whole SPA
Select-String -Path artifacts\frontend_unmin\*.js -Pattern 'ShirtTemplate' -SimpleMatch -List   # 0 hits
Select-String -Path artifacts\frontend_unmin\*.js -Pattern 'PantsTemplate' -SimpleMatch -List   # 0 hits

# 2. The clothing group is exactly four tools
Select-String -Path artifacts\frontend_unmin\index-DPVV2ya5.js -Pattern 'name: `(list_clothing_collection|generate_clothing|edit_clothing|get_clothing)`'

# 3. UPLOAD_GUIDE exists, is exported, and has exactly one consumer
Select-String -Path artifacts\frontend_unmin\clothing-62l72JIa.js -Pattern 'UPLOAD_GUIDE|activeTab'
Select-String -Path artifacts\frontend_unmin\ClothingPanel-CEM_quBl.js -Pattern 'fe\[e\.type\]'

# 4. saveClothingPng writes Documents/RobloxKit/clothing/<slug>.png
Select-String -Path artifacts\frontend_unmin\clothing-62l72JIa.js -Pattern 'saveClothingPng|renderPng'

# 5. An image upload is a Decal
Select-String -Path artifacts\frontend_unmin\UploaderPanel-DBEbMiEj.js -Pattern 'a Decal'

# 6. upload_asset posts base64-in-JSON to /api/roblox/upload
Select-String -Path artifacts\frontend_unmin\workspaceTools-oYxH4nqo.js -Pattern 'upload_asset|api/roblox/upload'

# 7. The Assistant plugin's own image tools
$b=[IO.File]::ReadAllBytes("artifacts\assistant_plugin.bin")
$t=[Text.Encoding]::GetEncoding(28591).GetString($b)
$t.IndexOf("Upload a batch of images from http server")      # -> 4665356
$t.IndexOf("'Image' and 'Decal' both insert as a Decal")     # -> present
$t.IndexOf("ShirtTemplate")                                   # -> 19662152 (property table only)

# 8. The blob store is the client's
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter 'mcp-termul-blob-*'
Select-String -Path src\**\*.ts,src-tauri\src\**\*.rs -Pattern 'mcp-termul-blob|tool-results'   # 0 hits
```
