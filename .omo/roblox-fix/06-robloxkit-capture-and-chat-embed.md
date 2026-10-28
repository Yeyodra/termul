# 06 - RobloxKit: capture, review/double-check, and how a finished artifact reaches the chat

**Scope.** Read-only static analysis of the unminified RobloxKit frontend bundle at
`C:\Users\Novella\Documents\Github\Robloxkit\artifacts\frontend_unmin\`. Nothing was built, run, or
modified.

**Method.** Every claim below is backed by a `file:line` citation into that directory and a verbatim
excerpt from the line(s). Line numbers are 1-based. The bundle is Vite/rolldown output, so helper
names are mangled (`S`, `Z`, `Se`, `og`, `_Component54`, ...); where a mangled name is exported under
a readable alias I give both, e.g. `Z` is exported as `designLoop`.

**Quotation fidelity.** Code excerpts are byte-accurate for identifiers, string literals, operators
and JSX. The bundle uses backtick template literals everywhere, so the excerpts contain backticks;
they are reproduced as-is. A small number of source lines contain UTF-8 glyphs (em dash, middle dot,
multiplication sign) that the bundle itself stores literally; where such a glyph appears inside an
excerpt it is transliterated to ASCII and flagged, because the glyph does not survive every terminal.

---

## 0. The headline: the user's belief is *partly* wrong

The user's model was:

> generation finishes -> a review / double-check step -> the result is captured -> the result is
> shown in the chat room / session as a viewport or preview.

Verified point by point:

| # | User's belief | Verdict | What actually happens |
|---|---|---|---|
| 1 | There is a review / double-check step | **CORRECT, and it is bigger than expected** | The review is a *multi-round, model-driven critique loop* with a hard cap of 2 rounds, fed a rendered multi-view contact sheet, that can force a full rebuild. Stage id `checking`, label `Checking`. |
| 2 | Then it captures the result | **CORRECT** | Several distinct captures exist for different consumers: a 256px thumbnail (PNG bytes), a 4-panel review sheet (JPEG), a flat template PNG, and a 1024x358 avatar sheet (JPEG). Which one is taken depends on the consumer, not on one single "capture" step. |
| 3 | Then it displays it in the chat as a viewport or preview | **WRONG** | The chat transcript does **not** embed the artifact at all. Not as a static image, not as a live 3D viewport, not as inline bytes. What lands in the transcript is a **text-only task card** with a title, a one-line summary, and a button labelled `Open in <Panel>`. The artifact itself is only ever rendered inside the generator's own panel. |

There is one important nuance to point 3 that makes the belief *half* right: **tool results** (as
opposed to background task results) *do* carry images into the transcript, as small clickable
thumbnails. So "the chat shows a picture of the artifact" is true when the assistant calls
`generate_clothing`/`generate_3d` as a *tool* and false when the same work runs as a *background task*.
Section 3.2 and 3.3 dissect both paths.

---

## 1. The generator loop

### 1.1 There is exactly one loop implementation, shared by all generators

Every generator (3D, clothing, VFX, GFX, icons, SFX, skybox, textures, cutscenes, animations) calls
the same driver. It is `Se` in `gen3d-BAdfthxw.js`, exported under the readable alias `designLoop`:

`gen3d-BAdfthxw.js:415-432`
```js
var he = e({
  MAX_REVIEW_ROUNDS: () => 2,
  TEXTURE_EXAMPLES: () => R,
  askBrain: () => J,
  categoryGuide: () => z,
  designLoop: () => Z,
  detectRig: () => B,
  droppedConnection: () => Ce,
  extractSpec: () => q,
  generateModel: () => X,
  generatorBrain: () => Ee,
  involvesTexturing: () => W,
  prepareGeneration: () => K,
  rigGuide: () => H,
  setGeneratorBrain: () => De,
  systemPrompt: () => U,
  texturingGuide: () => G
});
```

The function that does the work is `Se`, reached through `Z`:

`gen3d-BAdfthxw.js:771-813`
```js
async function Z(e) {
  let {
    choice: n,
    notice: r
  } = await j({
    creator: e.creator ?? _(e.scope),
    brain: e.brain,
    provider: e.provider,
    token: e.token
  });
  if (r) {
    e.onStage?.({
      stage: `designing`,
      detail: r
    });
  }
  let i = F(e.scope, e.brain, n);
  try {
    return {
      ...(await Se({
        ...e,
        choice: n
      })),
      modelName: oe(e.brain, e.provider, n)
    };
```

and the signature:

`gen3d-BAdfthxw.js:814-836`
```js
async function Se({
  action: e,
  system: t,
  first: n,
  prompt: r,
  what: i = `design`,
  normalize: a = e => e,
  extract: o = q,
  missing: s,
  question: l,
  accept: u,
  build: d,
  review: f,
  brain: p,
  provider: m,
  token: h,
  signal: g,
  scope: _,
  onStage: v,
  rounds: y = 2,
  vision: b = true,
  choice: x = null
}) {
```

Two constants govern the caps:

`gen3d-BAdfthxw.js:527-528`
```js
var ge = 2;
var _e = 3;
```

`ge` (=2) is the number of *review rounds*; `_e` (=3) is the number of *build-rejection retries*.
`Q` (=2) is the number of *connection-drop retries*:

`gen3d-BAdfthxw.js:1015`
```js
var Q = 2;
```

### 1.2 The exact stage sequence

The loop emits stage ids through `onStage`. The four ids are `designing`, `building`, `checking`,
`fixing`, plus a terminal `Saving` emitted by each generator wrapper. The display labels are per
generator. Clothing:

`clothing-62l72JIa.js:272-277`
```js
var I = {
  designing: `Designing`,
  building: `Drawing`,
  checking: `Checking`,
  fixing: `Fixing`
};
```

3D:

`generator-BkAchkKU.js:203-208`
```js
var te = {
  designing: `Designing`,
  building: `Building`,
  checking: `Checking`,
  fixing: `Fixing`
};
```

All ten generators, for the record:

| Generator | designing | building | checking | fixing | Source |
|---|---|---|---|---|---|
| 3D (spec) | `Designing` | `Building` | `Checking` | `Fixing` | `generator-BkAchkKU.js:204-207` |
| Clothing | `Designing` | `Drawing` | `Checking` | `Fixing` | `clothing-62l72JIa.js:273-276` |
| VFX | `Designing` | `Simulating` | `Checking` | `Fixing` | `vfx-Dbgg4Adn.js:253-256` |
| GFX | `Composing` | `Rendering` | `Checking` | `Fixing` | `gfx-CVkb5YLh.js:280-283` |
| Icons | `Designing` | `Drawing` | `Checking` | `Fixing` | `icons-BpUOWggy.js:120-123` |
| SFX | `Designing` | `Synthesising` | `Listening` | `Fixing` | `sfx-C9VkZ_Hq.js:188-191` |
| Skybox | `Designing` | `Drawing` | `Checking` | `Fixing` | `skybox-DQ303r0h.js:198-201` |
| Textures | `Designing` | `Rendering` | `Checking` | `Fixing` | `textures-Dx9L9-nO.js:122-125` |
| Cutscene | `Writing the script` | `Blocking the shots` | `Checking the staging` | `Fixing` | `cutscenes-ByeUHDHa.js:1373-1376` |
| Animation | `Keying the poses` | `Building the keyframes` | `Checking the motion` | `Fixing` | `animations-t4fuf2vl.js:916-919` |

Note the SFX generator relabels the review stage to **`Listening`** - i.e. the "review" step is
modality-appropriate, not always visual.

The ordering, taken directly from the control flow:

**Step 1 - `designing`.** The first model call. The conversation starts with a single user message.

`gen3d-BAdfthxw.js:837-843`
```js
  let S = [{
    role: `user`,
    text: n.text,
    ...(n.image ? {
      image: n.image
    } : {})
  }];
  let C = false;
```

`gen3d-BAdfthxw.js:884`
```js
  let T = await w(`designing`);
```

`w` is the model call wrapper; it stamps the stage on every attempt:

`gen3d-BAdfthxw.js:845-883`
```js
  let w = async n => {
    v?.({
      stage: n,
      detail: `${c(p)} is ${n}`
    });
    for (let r = 0;; r++) {
      try {
        let r = await J({
          brain: p,
          provider: m,
          token: h,
          history: S,
          signal: g,
          scope: _,
          system: t,
          choice: x,
          action: C ? undefined : e,
          onPhase: e => v?.({
            stage: n,
            detail: e
          })
        });
        C = true;
        S.push({
          role: `assistant`,
          text: r
        });
        return r;
      } catch (e) {
        if (g?.aborted || e?.name === `AbortError` || r >= Q || !Ce(e)) {
          throw e;
        }
        v?.({
          stage: n,
          detail: `The connection dropped; asking ${c(p)} again (${r + 1} of ${Q})`
        });
      }
    }
  };
```

**Step 2 - `building`.** Extract JSON from the reply, hand it to the deterministic builder. If the
builder throws with `problems`, the model is told and asked again, up to `_e` (=3) times.

`gen3d-BAdfthxw.js:888-916`
```js
  for (let e = 0;; e++) {
    E = o(T);
    let t = E ? null : [s ?? `The reply had no JSON ${i}. Answer with one \`\`\`json block.`];
    if (E) {
      a(E);
      v?.({
        stage: `building`,
        detail: `Building it`
      });
      try {
        D = await d(E);
      } catch (e) {
        t = e.problems ?? [String(e.message ?? e)];
      }
    }
    if (!t) {
      break;
    }
    if (e >= _e) {
      throw Error(`The AI's ${i} could not be built: ${t.slice(0, 5).join(`; `)}`);
    }
    O.push(`fixed ${t.length} ${i} problem(s)`);
    S.push({
      role: `user`,
      text: `The engine rejected the ${i}:\n- ${t.slice(0, 20).join(`
- `)}\nReturn the whole corrected ${i}.`
    });
    T = await w(`fixing`);
  }
```

Note: a *build* rejection is stage `fixing`, not `checking`. Two different rejection kinds exist.

**Step 3 - `checking`.** This is the review / double-check the user remembers. It runs `rounds`
times (default 2, capped by `MAX_REVIEW_ROUNDS = 2`).

`gen3d-BAdfthxw.js:917-938`
```js
  let k = b;
  for (let e = 0; e < y; e++) {
    v?.({
      stage: `checking`,
      detail: `Checking the result`
    });
    let t = k && D.sheet && (await we(p));
    let {
      lead: n,
      facts: s,
      layout: c = ``
    } = f(D, t);
    let m = l ? `\n${l({
      prompt: r,
      what: i,
      round: e
    })}` : `\nDoes it match the request "${r}"? If it does and there are no errors, reply with the single word DONE. Otherwise return the whole corrected ${i}.`;
    S.push({
      role: `user`,
      text: `${n} ${s}${c}${m}`,
      image: t ? D.sheet : undefined
    });
```

Read this carefully, because it answers "what is shown to the model":

- `t` is a boolean: can this brain take images at all (`we`), AND did the builder produce a
  `sheet`, AND is `vision` still enabled. `k = b` initialises `k` from the `vision` parameter
  (line 917).
- If `t` is true, the review message is a **multimodal** user message: a text preamble plus
  `image: D.sheet` - the actual rendered contact sheet, as a JPEG data URL.
- If `t` is false, the message is text-only and the review function is told so, which is why every
  `review` callback has two branches (`lead: n ? ... : 'no picture: judge it from ...'`).

The `review` callback is supplied by each generator and returns `{ lead, facts, layout }`. For
clothing:

`clothing-62l72JIa.js:130-135`
```js
    review: (e, t) => ({
      lead: t ? `Here is the design on the avatar (front, back, left side) and the flat template.` : `The renderer drew it (no picture: judge it from the description below).`,
      facts: e.report.issues.length ? `\nChecks:\n- ${e.report.issues.map(e => `${e.level}: ${e.message}`).join(`
- `)}` : `It passes the checks.`,
      layout: x(e.design, e.report)
    }),
```

For 3D:

`gen3d-BAdfthxw.js:745-753`
```js
    review: (e, n) => {
      let r = e.report.issues.map(e => `${e.level}: ${e.message}`);
      return {
        lead: n ? `Here is what the engine built (front, right, top, three-quarter${t === `accessory` ? `, on a mannequin for scale` : ``}${t === `character` ? `; and on the right, posed mid-stride in a test walk, from the side and three-quarters: check no joint opens a gap and every limb bends where it should` : ``}).` : `The engine built it (no picture: judge it from the layout below).`,
        facts: `${e.report.triangles} triangles, size ${e.report.size.join(` x `)} studs.${r.length ? `\nProblems:\n- ${r.join(`
- `)}` : ` It passes the rules.`}`,
        layout: e.layout ? `\nWhere each top-level part ended up (studs; +Y up, front +Z):\n${e.layout}` : ``
      };
    },
```

(Excerpt note: `x` above stands for the multiplication glyph U+00D7 in the source.)

**What the model must return.** The default contract (no `question`/`accept` override) is: reply with
the single word `DONE` if the artifact matches the request and there are no errors; otherwise return
the **whole corrected artifact** again.

The Polyforge 3D path overrides this with a scored rubric:

`generate-BwNaPC_j.js:541-549`
```js
var $ = [`silhouette and proportions`, `anatomy and number of limbs`, `face readable from the front`, `every part attached (nothing floating, no gaps at joints)`, `level of detail for the request`, `colours`, `pose`];
function oe({
  prompt: e
}) {
  return `Review it critically against the request "${e}" before deciding.
1. For each picture (front, right side, back, three-quarter, and each close-up), list what is wrong or weak: be specific (which part, where, what it should be).
2. Score each of these 1 to 10, one per line as "name: N/10 - reason": ${$.join(`; `)}.
3. If every score is 8 or more and the checks found no errors, end your reply with the single word DONE. Otherwise return the whole corrected script in one \`\`\`js block, fixing the lowest scores first.`;
}
```

and its acceptance validator:

`generate-BwNaPC_j.js:550-566`
```js
function se({
  verdict: e,
  round: t
}) {
  let n = [...String(e).matchAll(/(\d+(?:\.\d+)?)\s*\/\s*10\b/g)].map(e => Number(e[1]));
  if (n.length < $.length - 2) {
    return `Score every item first (${$.join(`; `)}), each as "name: N/10 - reason", then decide.`;
  }
  let r = n.filter(e => e < 8);
  if (r.length) {
    return `${r.length} score${r.length > 1 ? `s are` : ` is`} under 8 (${r.join(`, `)}): it is not done. Return the whole corrected script, fixing those first.`;
  } else if (t + 1 < 2) {
    return `Look again at every picture and the close-ups as a demanding art director would: what still reads wrong at a glance (proportions, the face, the hands, parts that float or clip)? Fix what you find and return the whole corrected script; reply DONE only if you truly find nothing to improve.`;
  } else {
    return null;
  }
}
```

**Step 4 - on rejection.** Two sub-cases.

*Sub-case A: the model said DONE but the deterministic report has errors, or `accept` refuses it.*
The DONE is bounced, the model is told why, and asked again (at most 2 bounces per round).

`gen3d-BAdfthxw.js:955-978`
```js
    let g = o(h);
    let _ = false;
    for (let t = 0; !g && t < 2 && (/^\s*DONE\b/i.test(h) || /\bDONE\W*$/.test(h.trim())); t++) {
      let t = D.report.ok ? u?.({
        verdict: h,
        built: D,
        round: e
      }) ?? null : `The checks still find errors:\n- ${D.report.issues.filter(e => e.level === `error`).map(e => e.message).join(`
- `)}\nFix them and return the whole corrected ${i}.`;
      if (!t) {
        _ = true;
        break;
      }
      O.push(`review ${e + 1}: DONE not accepted`);
      S.push({
        role: `user`,
        text: t
      });
      h = await w(`checking`);
      g = o(h);
    }
    if (_ || !g) {
      break;
    }
```

Read the guard: `D.report.ok ? accept(...) : "<errors>"`. So a DONE is *only* honoured when the
deterministic checker also passed **and** the optional `accept` hook returned `null`. If
`D.report.ok` is false, the DONE is impossible to accept regardless of what the model says.

*Sub-case B: the model returned a corrected artifact.* That goes to `fixing`, and the rebuilt result
becomes the new `D` for the next review round.

`gen3d-BAdfthxw.js:979-1008`
```js
    for (let t = 0; g; t++) {
      g = a(g) ?? g;
      v?.({
        stage: `fixing`,
        detail: `Rebuilding with the corrections`
      });
      try {
        D = await d(g);
        E = g;
        O.push(`revised after review ${e + 1}`);
        break;
      } catch (e) {
        let n = e.problems ?? [String(e.message ?? e)];
        if (t >= 2) {
          O.push(`a revision did not build (${n[0]})`);
          g = null;
          break;
        }
        S.push({
          role: `user`,
          text: `The engine rejected the ${i}:\n- ${n.slice(0, 20).join(`
- `)}\nReturn the whole corrected ${i}.`
        });
        g = o(await w(`fixing`));
      }
    }
    if (!g) {
      break;
    }
  }
  return {
    result: E,
    built: D,
    notes: O
  };
}
```

**Step 5 - the vision fallback.** If the brain refuses the image (throws while the image was
attached), the loop silently drops to text-only review and records it in `notes`.

`gen3d-BAdfthxw.js:939-954`
```js
    let h;
    try {
      h = await w(`checking`);
    } catch (e) {
      if (!t || e?.name === `AbortError`) {
        throw e;
      }
      k = false;
      O.push(`reviewed without pictures (the brain refused the image)`);
      let n = f(D, false);
      S[S.length - 1] = {
        role: `user`,
        text: `${n.lead} ${n.facts}${n.layout ?? ``}${m}`
      };
      h = await w(`checking`);
    }
```

**Step 6 - `Saving`.** Every generator wrapper emits a `Saving` stage after the loop returns, before
it writes to disk. Clothing:

`clothing-62l72JIa.js:305-339`
```js
  n(`Saving`, null);
  let m;
  if (l) {
    m = u(await w.get(a), F(p, {
      prompt: r,
      brain: s?.brain
    }));
  } else {
    let e = Date.now();
    m = {
      id: d(),
      name: p.raw?.name || r.slice(0, 40),
      type: i,
      prompt: r,
      createdAt: e,
      updatedAt: e,
      current: 1,
      versions: [{
        ...F(p, {
          prompt: r,
          brain: s?.brain
        }),
        n: 1,
        createdAt: e
      }]
    };
  }
  await w.save(m, await P(p.design, p.canvas));
  return {
    itemId: m.id,
    name: m.name,
    version: m.current,
    ok: p.report.ok,
    notes: p.notes
  };
```

### 1.3 How the stage reaches the UI

`onStage` is supplied by the generator wrapper from the task's `report` callback:

`clothing-62l72JIa.js:278-304`
```js
async function L(e, {
  signal: t,
  report: n
}) {
  let {
    prompt: r,
    type: i,
    id: a,
    images: o = [],
    ctx: s
  } = e;
  let l = a ? await w.get(a) : null;
  let f = await N(g());
  let p = await S({
    prompt: r,
    type: l?.type ?? i,
    base: l ? c(l).design : undefined,
    images: o,
    ...(s ?? {}),
    scope: a ? `clothing/${a}` : `clothing/new-${Date.now()}`,
    signal: t,
    build: f,
    onStage: ({
      stage: e,
      detail: t
    }) => n(I[e] ?? e, t)
  });
```

`n` is `report` from the task runner:

`tasks-Rr6W1sdh.js:273-288`
```js
  let a = (t, n = null, i = {}) => {
    if (r.aborted) {
      return;
    }
    let a = Date.now();
    let o = h(e.id);
    let s = t ?? o?.stage;
    if (!o || s !== o.stage || n !== o.detail || !!Object.keys(i).length || !(a - o.activityAt < 1000)) {
      v(e.id, {
        stage: s,
        detail: n,
        activityAt: a,
        ...i
      });
    }
  };
```

so the task object carries `stage` and `detail`, which the panel shows as `Changing - <stage>`:

`ClothingPanel-CEM_quBl.js:200-210`
```js
      })} newLabel={`New`} kinds={G} kindOf={e => e.type} meta={e => [K[e.type]?.label, `v${e.current}`].join(` - `)} readThumb={L.thumbnail} onRename={L.rename} onDuplicate={L.duplicate} onDelete={O.request} placeholder={`Search designs`} empty={`Clothing you design lands here, with every version.`} fallbackIcon={V} jobs={<_Component3 jobs={n} label={`Designing`} onCancel={te} onRetry={I} onDismiss={P} />} busyOf={e => {
        let t = r(e.id);
        if (t) {
          if (t.status === `queued`) {
            return `Waiting to change`;
          } else {
            return `Changing - ${t.stage}`;
          }
        } else {
          return null;
        }
```

---

## 2. The capture: every place a render becomes bytes or a URL

There is no single "capture" call. There are **five distinct capture functions**, each with its own
format, size and consumer. They are enumerated below with exact numbers.

### 2.1 `renderClothingThumbnail` - 256x256 PNG bytes, the durable thumbnail

`avatarRender-DVeE1evW.js:49-62`
```js
async function m(e, {
  rig: t = `R15`,
  skin: n
} = {}, r = 256) {
  let i = c({
    rig: t,
    skin: n,
    clothes: e
  });
  let a = p(d(i, null), f[`3/4`], r, r);
  let o = await new Promise(e => a.toBlob(e, `image/png`));
  i.dispose();
  return new Uint8Array(await o.arrayBuffer());
}
```

- Format: **PNG**, via `toBlob`.
- Size: `r x r`, default **256 x 256** (`r = 256`).
- Camera: the `3/4` direction from `f`, i.e. `[0.75, 0.25, 1]` (`avatarRender-DVeE1evW.js:38`).
- Returns **raw `Uint8Array` bytes**, not a data URL.
- Exported as `renderClothingThumbnail` (`avatarRender-DVeE1evW.js:97`).

Called from clothing's save path:

`clothing-62l72JIa.js:245-257`
```js
async function P(e, t) {
  let n = await M();
  let {
    rig: r,
    skin: i
  } = g();
  return n.renderClothingThumbnail({
    [e.type]: t
  }, {
    rig: r,
    skin: i
  });
}
```

and used at `clothing-62l72JIa.js:332`:
```js
  await w.save(m, await P(p.design, p.canvas));
```

### 2.2 `renderClothingSheet` - 1024x358 JPEG, the *review* contact sheet

This is the one the model is shown during `checking`.

`avatarRender-DVeE1evW.js:63-96`
```js
function h(e, t, {
  rig: n = `R15`,
  skin: r
} = {}, i = 256) {
  let a = c({
    rig: n,
    skin: r,
    clothes: e
  });
  let o = d(a, 1447963);
  let s = document.createElement(`canvas`);
  s.width = i * 4;
  s.height = Math.round(i * 1.4);
  let l = s.getContext(`2d`);
  l.fillStyle = `#101113`;
  l.fillRect(0, 0, s.width, s.height);
  [[`front`, f.front], [`back`, f.back], [`left side`, f.left]].forEach(([e, t], n) => {
    let r = p(o, t, i, s.height);
    l.drawImage(r, n * i, 0);
    l.fillStyle = `rgba(255,255,255,0.85)`;
    l.font = `14px sans-serif`;
    l.fillText(e, n * i + 8, 18);
  });
  if (t) {
    let e = Math.min(i / t.width, s.height / t.height);
    let n = t.width * e;
    let r = t.height * e;
    l.drawImage(t, i * 3 + (i - n) / 2, (s.height - r) / 2, n, r);
    l.fillStyle = `rgba(255,255,255,0.85)`;
    l.fillText(`template`, i * 3 + 8, 18);
  }
  a.dispose();
  return s.toDataURL(`image/jpeg`, 0.85);
}
```

- Format: **JPEG quality 0.85**, via `toDataURL` - a data URL string, not bytes.
- Size: `i * 4` wide by `round(i * 1.4)` tall; with the default `i = 256` that is **1024 x 358**.
- Content: 4 tiles left-to-right - `front`, `back`, `left side`, `template` (the flat atlas).
- Background `#101113`, white 85% 14px labels.
- Exported as `renderClothingSheet` (`avatarRender-DVeE1evW.js:97`).

Wired into the builder as `sheet`:

`clothing-62l72JIa.js:229-243`
```js
    let s = r.attachImages(i, a);
    let c = await r.renderToCanvas(s, document.createElement(`canvas`));
    let l = c.getContext(`2d`).getImageData(0, 0, c.width, c.height).data;
    return {
      design: s,
      canvas: c,
      report: r.checkDesign(s, l),
      sheet: e ? r.renderClothingSheet({
        [s.type]: c
      }, c, {
        rig: t,
        skin: n ?? r.SKIN_TONES[0].hex
      }) : null
    };
```

and that `sheet` is exactly `D.sheet` in the review loop (`gen3d-BAdfthxw.js:923`, `937`).

### 2.3 `renderThumbnail` (3D) - 256x256 PNG bytes

`render-D__CO5co.js:78-91`
```js
async function T(e, t = {}, n = 256) {
  let {
    scene: r,
    focus: i,
    radius: a
  } = S(e, {
    ...t,
    withMannequin: false
  });
  let o = C(r, i, a, [0.9, 0.55, 1.1], n);
  let s = await new Promise(e => o.toBlob(e, `image/png`));
  w(r);
  return new Uint8Array(await s.arrayBuffer());
}
```

- Format **PNG**, size `n x n` default **256 x 256**, returns `Uint8Array`.
- Camera `[0.9, 0.55, 1.1]`, no mannequin.

### 2.4 `renderViewSheet` (3D) - up to 768x512 JPEG, the *review* sheet

`render-D__CO5co.js:92-134`
```js
function E(e, t = {}, n = 256) {
  let {
    scene: r,
    focus: i,
    radius: a,
    mesh: o
  } = S(e, t);
  let s = [[`front`, [0, 0.15, 1]], [`right`, [1, 0.15, 0]], [`top`, [0.001, 1, 0.001]], [`3/4`, [0.9, 0.55, 1.1]]];
  let c = e.rigSpec ? p(e.rigSpec, e) : [];
  let l = c.length ? 3 : 2;
  let u = document.createElement(`canvas`);
  u.width = n * l;
  u.height = n * 2;
```

and the encode:

`render-D__CO5co.js:133`
```js
  return u.toDataURL(`image/jpeg`, 0.85);
```

- Format **JPEG 0.85** data URL.
- Grid `l` columns x 2 rows at `n` px per tile: with `n = 256`, `l = 2` -> **512 x 512**; with a rig
  present `l = 3` -> **768 x 512**.
- Views: `front`, `right`, `top`, `3/4`, plus `walk, side` and `walk, 3/4` when the model has a rig.

### 2.5 `renderReviewSheets` (3D) - two 1536x1536-ish JPEGs at 0.88, the *actual* review input

`render-D__CO5co.js:135-180` (signature and the sheet builder)
```js
function D(a, o = {}, {
  focus: s = [],
  tile: c = 768
} = {}) {
  let {
    scene: l,
    mesh: u
  } = S(a, o);
  l.background = new r(8225418);
  l.children.filter(e => e.isLight).forEach(e => l.remove(e));
  l.add(new t(16777215, 4210752, 1.3));
  let d = new e(16777215, 2.4);
  d.position.set(5, 9, 8);
  let f = new e(14674175, 0.9);
  f.position.set(-7, 3, 4);
  let m = new e(16777215, 1.1);
  m.position.set(0, 6, -9);
  l.add(d, f, m);
  let h = new i().setFromObject(u);
  let v = u.position.clone();
  let y = e => {
    let t = e.length > 1 ? 2 : 1;
    let n = Math.ceil(e.length / t);
    let r = document.createElement(`canvas`);
    r.width = c * t;
    r.height = c * n;
```

the encode:

`render-D__CO5co.js:175`
```js
    return r.toDataURL(`image/jpeg`, 0.88);
```

the return:

`render-D__CO5co.js:224-228`
```js
  let E = x.length ? y(x.slice(0, 4)) : null;
  T?.dispose();
  w(l);
  return [b, E].filter(Boolean);
}
```

- Format **JPEG 0.88**, two data URLs.
- Tile `c = 768` default. Sheet 1 has 4 views -> 2 columns x 2 rows -> **1536 x 1536**.
  Sheet 2 has up to 4 crops -> 2 x 2 -> **1536 x 1536**.
- Exported as `renderReviewSheets` (`render-D__CO5co.js:262`), and it is the `sheet` the 3D builder
  hands back:

`generator-BkAchkKU.js:135-137`
```js
    let m = e ? n.renderReviewSheets(c, t, {
      focus: a?.focus ?? []
    }) : null;
```

### 2.6 `renderPng` (clothing flat atlas) - 585x559 or 512x512 PNG bytes

`render-CpljO1Hx.js:350-354`
```js
async function _(e) {
  let t = await g(e, document.createElement(`canvas`));
  let n = await new Promise(e => t.toBlob(e, `image/png`));
  return new Uint8Array(await n.arrayBuffer());
}
```

The canvas is sized from the Roblox template geometry:

`layout-yFs0_M_2.js:74-86`
```js
function i(e) {
  if (e === `tshirt`) {
    return {
      width: 512,
      height: 512
    };
  } else {
    return {
      width: 585,
      height: 559
    };
  }
}
```

so `renderPng` yields **585x559 PNG** for shirt/pants and **512x512 PNG** for a T-shirt. This is the
exact atlas Roblox expects for a classic-clothing upload.

### 2.7 Other captures (for completeness)

| Function | Format | Size | Source |
|---|---|---|---|
| `renderThumbnail` (3D) | PNG bytes | 256x256 | `render-D__CO5co.js:78-91` |
| `renderViewSheet` (3D) | JPEG 0.85 | 512x512 or 768x512 | `render-D__CO5co.js:92-134` |
| `renderReviewSheets` (3D) | JPEG 0.88 | 1536x1536 x2 | `render-D__CO5co.js:135-228` |
| GFX sheet | JPEG 0.85 | scaled to max 1024 wide | `gfx-CVkb5YLh.js:257-261` |
| Icons sheet | PNG | 192px tiles | `icons-BpUOWggy.js:76-80` |
| Icons thumbnail | PNG bytes | 256x256 | `icons-BpUOWggy.js:84-99` |
| SFX sheet | PNG | 256x256 | `sfx-C9VkZ_Hq.js:147-154`, `:167` |
| VFX sheet | JPEG 0.85 | 3-col grid | `render-CzBncmsu.js:113-117` |
| VFX thumbnail | PNG bytes | 256x256 | `render-CzBncmsu.js:119-136` |
| Texture review sheet | PNG | 4x2 tiles at `t` | `render-Ej67xP5V.js:1002-1021` |
| Animation sheet | PNG | 768x384 default | `sheet-DVAmNjwR.js:66-135` |
| Music timeline | PNG bytes | 256x256 | `music-DejM99vB.js:1360-1379` |
| Studio viewport | base64 in MCP `image` | Studio's own | `index-DPVV2ya5.js:24786-24805` |

Note the last row: the *Studio viewport* capture is a completely separate path from the generator
captures. It is the `capture_viewport` agent tool, not part of generation:

`index-DPVV2ya5.js:24786-24805`
```js
  name: `capture_viewport`,
  parameters: {
    type: `object`,
    properties: {}
  },
  call: async e => {
    let t = ((await e.callTool(`screen_capture`, {
      capture_id: `chat-${Date.now()}`
    }))?.content ?? []).find(e => e.type === `image`);
    if (!t) {
      throw Error(`Studio returned no image`);
    }
    return {
      result: {
        captured: true
      },
      summary: `Captured the Studio viewport`,
      image: `data:${t.mimeType};base64,${t.data}`
    };
  }
```

### 2.8 Where the captured bytes are stored

The thumbnail is the only capture that is persisted per item. It is written to the **workspace
filesystem**, not IndexedDB and not a server upload.

`collection-DAIZY86Y.js:103-115`
```js
    async thumbnail(t) {
      return n(await l(`${e}/${t}/thumb.png`));
    },
    async save(t, n) {
      await h(t.id);
      await a(await l(`${e}/${t.id}/item.json`), JSON.stringify(t, null, 1));
      if (n) {
        await r(await l(`${e}/${t.id}/thumb.png`), n);
      }
      p &&= [t, ...p.filter(e => e.id !== t.id)];
      m();
      return t;
    },
```

`n` is `readFile` (bytes), `a` is `writeTextFile`, `r` is `writeFile` (bytes), from the Tauri fs
plugin (`dist-js-BHTFfXLT.js:39-64`). The root is resolved against the Documents directory:

`workspaceTools-oYxH4nqo.js:17`
```js
var _ = `RobloxKit`;
```

`workspaceTools-oYxH4nqo.js:103-105`
```js
async function E(e = ``) {
  let t = await c(await h(), _);
```

`dist-js-BHTFfXLT.js:29-33`
```js
async function a() {
  return t(`plugin:path|resolve_directory`, {
    directory: i.Document
  });
}
```

So clothing thumbnails live at `Documents/RobloxKit/clothing/collection/<id>/thumb.png` and the item
metadata at `.../item.json`. The collection root string is declared here:

`clothing-62l72JIa.js:172-175`
```js
var w = s({
  root: `clothing/collection`,
  kind: `clothing`
});
```

and for 3D:

`collection-DAIZY86Y.js:163-166`
```js
var g = h({
  root: `3d/collection`,
  kind: `3d`
});
```

The task list itself is stored in a `tasks.json` key-value file, capped and truncated:

`tasks-Rr6W1sdh.js:20-21`
```js
var r = `tasks.json`;
var i = 60;
```

`tasks-Rr6W1sdh.js:78-88`
```js
function S(e) {
  if (e == null) {
    return e;
  }
  let t = typeof e == `string` ? e : JSON.stringify(e);
  if (t.length > 20000) {
    return `${t.slice(0, 20000)}... (cut)`;
  } else {
    return e;
  }
}
```

**There is no IndexedDB anywhere in the bundle.** The only storage primitives are: the Tauri fs
plugin (files under Documents/RobloxKit), the Tauri store plugin (`dist-js-C2pGxroy.js`, used for
`tasks.json` and `auth.json`), and `localStorage` (small preferences and the per-creator model choice).
A grep for `indexedDB` across all 166 `.js` files returns only four hits, all inside a *sandbox
deny-list* for the Luau/JS runner (`run-CxH39Tsb.js:1095`, `:1134`, `worker-DZ3hS97o.js:36887`,
`:36926`), not a real use.

### 2.9 The one place a capture goes to the server

When a capture needs to travel to the model or into a chat transcript, it is first **uploaded to the
media store** and replaced by a `media:` handle:

`index-DPVV2ya5.js:17795-17811`
```js
async function yc(e, t = `image/png`) {
  if (_c(e)) {
    return e;
  }
  let n = typeof e == `string` ? vc(e) : {
    mime: t,
    bytes: e
  };
  if (!n) {
    throw Error(`not an image`);
  }
  return j(`media_put`, n.bytes, {
    headers: {
      "x-mime": n.mime
    }
  });
}
```

`j` is the Tauri `invoke` (`core-DrWsfDbQ.js:105-107`), so `media_put` is a backend command that
returns an id. The handle format is checked by:

`index-DPVV2ya5.js:17779`
```js
var _c = e => typeof e == `string` && e.startsWith(`media:`);
```

and resolved back to a blob URL by:

`index-DPVV2ya5.js:17814-17823`
```js
async function Sc(e) {
  let t = await j(`media_get`, {
    id: e
  });
  let n = e.split(`.`).pop();
  let r = n === `jpg` || n === `jpeg` ? `image/jpeg` : n === `webp` ? `image/webp` : n === `gif` ? `image/gif` : `image/png`;
  return URL.createObjectURL(new Blob([t], {
    type: r
  }));
}
```

Note that `media_put` is only reached from the *tool result* path and the *user attachment* path. The
background task path never calls it - see section 4.
---

## 3. The transcript / chat embed - and where the user's belief breaks

### 3.1 The transcript renderer

The chat pane is rendered by `_Component41` in `index-DPVV2ya5.js`. It is a `kind`-switch over
message items:

`index-DPVV2ya5.js:40604-40652`
```js
function _Component41({
  item: e,
  onContinue: t,
  running: n,
  editing: r,
  onEdit: i,
  onCancelEdit: a,
  onSaveEdit: o,
  onRetry: s
}) {
  if (e.kind === `user`) {
    ...
  }
  if (e.kind === `assistant`) {
    const Component405 = `div`;
    const Component406 = `div`;
    return <_Component43 path={`agent/reply`} status={e.streaming ? `running` : `done`} tag={e.streaming ? `writing` : null}><Component406 className={`msg-assistant`}>{e.reasoning && <_Component51 text={e.reasoning} streaming={e.streaming} />}{e.text && <Component405 className={`relative`}><YE text={e.text} />{e.streaming && <_Component52 />}</Component405>}{!e.text && e.streaming && !e.reasoning && <_Component42 since={e.startedAt} />}</Component406></_Component43>;
  } else if (e.kind === `plan`) {
    return <_Component53 entries={e.entries} />;
  } else if (e.kind === `interrupted`) {
    ...
  } else if (e.kind === `task`) {
    return <_Component54 item={e} />;
  } else if (e.kind === `compaction`) {
    return <QE item={e} />;
  } else if (e.kind === `notice`) {
    ...
  } else {
    return <Oc item={e} />;
  }
}
```

The allowed top-level kinds are enumerated:

`index-DPVV2ya5.js:40509`
```js
var nD = new Set([`user`, `assistant`, `plan`, `interrupted`, `task`, `notice`, `compaction`]);
```

Everything else (including `tool`) is fanned into a "tool group" and rendered by `Oc`:

`index-DPVV2ya5.js:40510-40537`
```js
function rD(e) {
  let t = [];
  for (let n of e) {
    if (nD.has(n.kind)) {
      t.push({
        key: n.id,
        item: n,
        live: n.kind === `assistant` && n.streaming
      });
      continue;
    }
    let e = t[t.length - 1];
    if (e?.tools) {
      e.tools.push(n);
    } else {
      t.push({
        key: `fan-${n.id}`,
        tools: [n]
      });
    }
  }
```

So there are exactly **two** ways an artifact can appear in the transcript:

- `kind === 'task'` -> `_Component54`, the task card.
- `kind === 'tool'` -> `Oc` -> `Ac`, the tool card.

### 3.2 The answer: a finished **background generation** is a text-only card with a button

This is `_Component54`, the task card. Read the whole JSX carefully - there is no `<img>`, no
canvas, no viewport:

`index-DPVV2ya5.js:40743-40779`
```js
function _Component54({
  item: e
}) {
  let t = e.status === `done`;
  let n = {
    agent: `subagent`,
    clothing: `clothing`,
    vfx: `vfx`,
    gfx: `gfx`,
    icons: `icons`,
    sfx: `sfx`,
    texture: `texture`
  }[e.taskKind] ?? `3d`;
  const Component438 = `span`;
  const Component439 = `div`;
  const Component440 = `p`;
  const Component441 = `div`;
  const Component442 = `button`;
  const Component443 = `div`;
  const Component444 = `div`;
  return <_Component43 path={`task/${n}`} tag={t ? `done` : e.status} status={t ? `done` : `error`}><Component444 className={`task-card ${t ? `` : `task-card--bad`} m-rise`}><Component439 className={`task-card__head`}><Component438 className={`task-card__kind`}>{{
            agent: `Subagent`,
            clothing: `Clothing`,
            vfx: `VFX`,
            gfx: `GFX`,
            icons: `Icons`,
            sfx: `SFX`,
            texture: `Texture`
          }[e.taskKind] ?? `3D model`}</Component438><_Component2 className={`task-card__title`} title={e.title}>{e.title}</Component2></Component439>{e.summary && <Component441 className={`task-card__body`}>{e.taskKind === `agent` && t ? <YE text={e.summary} /> : <Component440>{e.summary}</Component440>}</Component441>}{e.link && <Component443 className={`tool-card__links`}><Component442 type={`button`} className={`btn btn--sm`} onClick={() => Qt(e.link)}>{`Open in `}{{
            clothing: `Clothing Creator`,
            vfx: `VFX Generator`,
            gfx: `GFX`,
            icons: `Icon Generator`,
            sfx: `SFX Generator`,
            texture: `Texture Generator`
          }[e.link.panel] ?? `3D Generator`}</Component442></Component443>}</Component444></_Component43>;
}
```

Concretely, the task card renders:

1. a kind chip: `Clothing` / `3D model` / `VFX` / ...
2. `e.title` - the prompt text (see section 4.1 for where it comes from)
3. `e.summary` - a single line of text
4. if `e.link` exists, a `<button>` labelled `Open in Clothing Creator` (or `3D Generator`, etc.)

That is the **entire** in-chat representation of a finished generation. There is no image, no
viewport, no inline bytes, no thumbnail. The card is a **clickable card that opens a panel** - the
user's option (c) - but only the *button* is clickable, not the card body, and the card shows no
visual of the artifact at all.

The click handler is `Qt`, imported from `acp-C1bBXu3Z.js` as `x`:

`index-DPVV2ya5.js:20`
```js
import { C as Mt, S as Nt, _ as Pt, a as Ft, b as It, c as Lt, d as Rt, f as zt, g as Bt, h as Vt, i as Ht, l as Ut, m as Wt, n as Gt, o as Kt, p as qt, r as Jt, s as Yt, u as Xt, v as Zt, x as Qt, y as $t } from "./acp-C1bBXu3Z.js";
```

and its definition, which lazy-loads the right panel module and calls `openIn<Panel>(id)`:

`acp-C1bBXu3Z.js:222-249`
```js
function te({
  panel: e,
  id: t
}) {
  if (e === `clothing`) {
    n(() => import(`./clothing-62l72JIa.js`).then(e => e.r).then(e => e.openInClothing(t)), __vite__mapDeps([33, 1, 2, 16, 11, 12, 6, 13, 17, 18, 3, 4, 5, 7, 8, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36]));
  } else if (e === `vfx`) {
    n(() => import(`./vfx-Dbgg4Adn.js`).then(e => e.d).then(e => e.openInVfx(t)), __vite__mapDeps([37, 1, 2, 16, 11, 12, 6, 13, 17, 18, 3, 4, 5, 7, 8, 9, 10, 15, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 38]));
```

and `openInClothing` does nothing but set the open id and fire a window event:

`clothing-62l72JIa.js:195-205`
```js
function A(e) {
  O({
    openId: e,
    error: null
  });
  window.dispatchEvent(new CustomEvent(`robloxkit:open-panel`, {
    detail: {
      panel: `clothing`
    }
  }));
}
```

The app shell listens for that event and switches the visible panel:

`index-DPVV2ya5.js:42464-42470`
```js
function TO() {
  let [e, t] = (0, L.useState)(`chat`);
  (0, L.useEffect)(() => {
    let e = e => e.detail?.panel && t(e.detail.panel);
    window.addEventListener(`robloxkit:open-panel`, e);
    return () => window.removeEventListener(`robloxkit:open-panel`, e);
  }, []);
```

So the sequence is: chat card -> button -> `openInClothing(id)` -> `open-panel` event -> app switches
the left panel to Clothing Creator -> the Clothing panel loads the item and renders it (3D preview
or flat template). **The artifact is only ever rendered inside the panel, never in the transcript.**

### 3.3 The exception: a **tool result** does put a thumbnail in the transcript

If the assistant calls `generate_clothing` as a *tool* (rather than as a background task), the tool
result carries an `image`, and `Ac` renders it.

`index-DPVV2ya5.js:17941-17961`
```js
function Ac({
  item: e
}) {
  let [t, n] = (0, L.useState)(false);
  let {
    name: r = `tool`,
    state: a = `running`
  } = e;
  let o = Nt(e);
  let c = Zt(e.output);
  ...
  return <Component270 className={`node tool-card tool-card--${a} is-${a} m-rise`}><Component261 className={`chain-port chain-port--in`} aria-hidden={`true`} /><Component267 type={`button`} className={`tool-card__head`} onClick={() => n(e => !e)} aria-expanded={t}>...
```

The image sources are collected here, and `Dc` renders the `Open in ...` link:

`index-DPVV2ya5.js:17961`
```js
  return <Component270 ...><Rc sources={[e.image, ...(e.images ?? [])].filter(Boolean)} />{c && <Dc link={c} />}{t && <Component269 className={`tool-card__body m-fade`}>...
```

`Rc` is the thumbnail strip with a click-to-zoom overlay:

`index-DPVV2ya5.js:18041-18072`
```js
function Rc({
  sources: e
}) {
  let [t, n] = (0, L.useState)(null);
  let [r, i] = (0, L.useState)({});
  ...
  if (e.length === 0) {
    return null;
  } else {
    ...
    return <Component283 className={`tool-card__thumbs`}>{e.map((e, t) => <Component281 type={`button`} className={`tool-card__thumb`} onClick={() => n(e)} title={`Show full size`} key={t}><_Component31 src={e} alt={`Tool result`} onLoad={e => {
          let {
            naturalWidth: n,
            naturalHeight: r
          } = e.currentTarget;
          i(e => ({
            ...e,
            [t]: `${n}x${r}`
          }));
        }} />{r[t] && <Component280 className={`tool-card__thumb-size`}>{r[t]}</Component280>}</Component281>)}{t && <Component282 className={`dialog__backdrop tool-card__zoom`} role={`dialog`} aria-modal={`true`} onClick={() => n(null)}><_Component31 src={t} alt={`Tool result, full size`} /></Component282>}</Component283>;
  }
}
```

`_Component31` resolves the source through `Tc`, which turns a `media:` handle into a blob URL:

`index-DPVV2ya5.js:18073-18085`
```js
function _Component31({
  src: e,
  ...t
}) {
  let n = Tc(e);
  if (n) {
    const Component284 = `img`;
    return <Component284 src={n} {...t} />;
  } else {
    const Component285 = `span`;
    return <Component285 className={`tool-card__thumb-loading`} aria-hidden={`true`} />;
  }
}
```

So: **a tool result shows a static `<img>` thumbnail (256px, from the item's `thumb.png`), inside an
expandable tool card, with a click-to-zoom dialog.** That is the user's option (a). It is never a
live viewport.

The `image` the tool returns is a `data:image/png;base64,` URL built from the stored thumbnail:

`index-DPVV2ya5.js:18853-18865`
```js
function bl(e) {
  let t = ``;
  for (let n = 0; n < e.length; n += 32768) {
    t += String.fromCharCode(...e.subarray(n, n + 32768));
  }
  return `data:image/png;base64,${btoa(t)}`;
}
async function xl(e) {
  try {
    return bl(await cr.thumbnail(e));
  } catch {
    return;
  }
}
```

used at `index-DPVV2ya5.js:18951` and `:18977`:
```js
        summary: `Drew ${e.name}`,
        image: await xl(e.id)
```

and immediately converted to a durable `media:` handle by the chat store so the transcript does not
carry megabytes of base64:

`index-DPVV2ya5.js:26818-26823`
```js
        if (typeof i == `string` && i.startsWith(`data:`)) {
          yc(i).then(t => r(n => n.map(n => n.id === e && n.image === i ? {
            ...n,
            image: t
          } : n))).catch(() => {});
        }
```

`yc` is the `media_put` uploader from section 2.9.

### 3.4 Summary table of the transcript embed

| Path | Rendered as | Visual present? | Source |
|---|---|---|---|
| Background task finishes (`kind: 'task'`) | text card: kind chip + title + one-line summary + `Open in ...` button | **No** | `index-DPVV2ya5.js:40743-40779` |
| Tool call returns an image (`kind: 'tool'`) | expandable tool card with 256px thumbnail strip + click-to-zoom | **Yes**, static `<img>` | `index-DPVV2ya5.js:17941-17961`, `18041-18072` |
| Assistant markdown contains `![...](media:...)` | inline `<img>` in the prose | **Yes**, static `<img>` | `index-DPVV2ya5.js:40025-40031` |
| Live 3D viewport in the transcript | **does not exist** | n/a | no `Preview3D` import in the chat renderer |

The last row is worth stating explicitly: `Preview3D` (`Preview3D-CIiMrTBA.js`) is imported by only
four files, and the chat renderer is not one of them:

```
ClothingPanel-CEM_quBl.js:22 : import { t as Pe } from "./Preview3D-CIiMrTBA.js";
GeneratorPanel-BNGBBwll.js:25 : import { t as Dt } from "./Preview3D-CIiMrTBA.js";
TexturePanel-D8uJ3dDt.js:19 : import { t as Ge } from "./Preview3D-CIiMrTBA.js";
```

`index-DPVV2ya5.js` (which owns the chat) never imports it.

---

## 4. The data shape

### 4.1 The chat item for a finished generation

`og` (exported as `reportTask`) is the single function that turns a finished task into a chat item:

`index-DPVV2ya5.js:26926-26956`
```js
function og(e, t) {
  if (!e || Uh.has(t?.id)) {
    return;
  }
  if (!Ph.has(e)) {
    e = Lm(e);
  }
  let n = t.result && typeof t.result == `object` ? t.result : null;
  let r = t.status === `done` ? n?.summary ?? (typeof t.result == `string` ? t.result.slice(0, 600) : n?.name ? `${n.name} is ready.` : `Done.`) : t.error ?? t.status;
  let i = {
    kind: `task`,
    id: `task-${t.id}`,
    taskId: t.id,
    title: t.title,
    taskKind: t.kind,
    status: t.status,
    summary: r,
    link: n?.itemId ? {
      panel: t.kind === `clothing` ? `clothing` : `generator`,
      id: n.itemId
    } : null
  };
  let a = () => J(e, {
    items: e => e.some(e => e.id === i.id) ? e : [...e, i]
  });
  if (q(e).loaded) {
    a();
  } else {
    Jh(e).then(a).catch(() => {});
  }
}
```

The chat item shape, in full:

```js
{
  kind: `task`,                    // fixed discriminator
  id: `task-<taskId>`,             // namespaced so it cannot collide with message ids
  taskId: `<taskId>`,              // back-reference into the task list
  title: <the prompt>,             // from the task, see below
  taskKind: <'clothing'|'gen3d'|'vfx'|...>,  // the task *kind*, not the item type
  status: <'done'|'failed'|'cancelled'|'interrupted'>,
  summary: <one line of text>,     // from result.summary, or "<name> is ready."
  link: { panel: <'clothing'|'generator'>, id: <itemId> } | null
}
```

Critical observations for the user's question:

- **The chat item references the artifact by `id` only.** `link.id` is the collection item id
  (e.g. `m-lx8f2a-a1b2`). No url, no bytes, no version number.
- **`title` is the prompt**, not the artifact name. It comes from the task record, which the queue
  function sets to the prompt:

`clothing-62l72JIa.js:356-380`
```js
function z({
  title: e,
  params: t,
  ctx: n,
  origin: r
}) {
  let a = i({
    kind: `clothing`,
    title: e,
    params: {
      ...t,
      ctx: {
        brain: n?.brain
      }
    },
    origin: r,
    link: t.id ? {
      panel: `clothing`,
      id: t.id
    } : null
  });
```

and `B`/`queueNewClothing` passes the prompt as `title`:

`clothing-62l72JIa.js:381-398`
```js
function B({
  prompt: e,
  type: t,
  images: n = [],
  ctx: r,
  origin: i = null
}) {
  return z({
    title: e,
    params: {
      prompt: e,
      type: t,
      images: n
    },
    ctx: r,
    origin: i
  });
}
```

- **`taskKind` is the task kind, not the item type.** For 3D it is `gen3d`, which falls through the
  label map to `3D model` and the panel map to `3D Generator`
  (`index-DPVV2ya5.js:40755`, `:40771`).

### 4.2 The artifact object in state

The durable artifact is the **collection item**. For clothing, built inline in the generator:

`clothing-62l72JIa.js:312-331`
```js
    let e = Date.now();
    m = {
      id: d(),
      name: p.raw?.name || r.slice(0, 40),
      type: i,
      prompt: r,
      createdAt: e,
      updatedAt: e,
      current: 1,
      versions: [{
        ...F(p, {
          prompt: r,
          brain: s?.brain
        }),
        n: 1,
        createdAt: e
      }]
    };
```

with the id generator:

`collection-DAIZY86Y.js:26`
```js
var d = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
```

so an id looks like `m-mc9x1k-a4f2`.

The full item shape (clothing):

```js
{
  id: `m-<base36 time>-<4 random>`,
  name: <string>,             // from the model's raw.name, or the first 40 chars of the prompt
  type: <'shirt'|'pants'|'tshirt'>,
  prompt: <string>,
  createdAt: <ms>,
  updatedAt: <ms>,
  current: <version number>,  // 1-based, points at versions[n].n
  versions: [ {
    prompt: <string>,
    design: <the full design object>,   // layers, background, type
    ok: <boolean>,                      // report.ok
    brain: <brain id | null>,
    modelName: <string | null>,
    note: <string | null>,
    n: <version number>,
    createdAt: <ms>
  } ]
}
```

For 3D the same envelope, but the version payload is a spec instead of a design, plus engine info:

`generator-BkAchkKU.js:182-202`
```js
function j(e, {
  prompt: t,
  brain: r,
  note: i,
  edits: a
}) {
  return {
    prompt: t,
    spec: e.spec,
    ...(e.script ? {
      engine: `polyforge`,
      script: e.script,
      edits: a ?? null
    } : {}),
    triangles: e.report.triangles,
    ok: e.report.ok,
    brain: r ? n(r) : null,
    modelName: e.modelName ?? null,
    note: i ?? (e.notes?.length ? e.notes.join(`; `) : null)
  };
}
```

Note `note` here is the **review log** - the `notes` array accumulated by the loop (`O.push(...)`)
joined with `; `. So the transcript of what the double-check actually did is persisted on the version
as a human-readable string. For clothing it is the same field:

`clothing-62l72JIa.js:258-271`
```js
function F(e, {
  prompt: t,
  brain: n,
  note: i
}) {
  return {
    prompt: t,
    design: e.design,
    ok: e.report.ok,
    brain: n ? r(n) : null,
    modelName: e.modelName ?? null,
    note: i ?? (e.notes?.length ? e.notes.join(`; `) : null)
  };
}
```

The generic item constructor for 3D is in the collection module:

`collection-DAIZY86Y.js:179-202`
```js
function k({
  name: e,
  category: t,
  accessoryType: n,
  prompt: r,
  version: i
}) {
  let a = Date.now();
  return {
    id: d(),
    name: e || `Untitled model`,
    category: t,
    accessoryType: n ?? null,
    prompt: r,
    createdAt: a,
    updatedAt: a,
    current: 1,
    versions: [{
      ...i,
      n: 1,
      createdAt: a
    }]
  };
}
```

### 4.3 The task record

The in-flight object is the task:

`tasks-Rr6W1sdh.js:119-136`
```js
  let a = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  c = [{
    id: a,
    kind: e,
    title: t || e,
    params: n,
    origin: r,
    link: i,
    status: `queued`,
    stage: `Waiting`,
    detail: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    activityAt: Date.now(),
    result: null,
    error: null
  }, ...c];
```

Note the id prefix collision hazard: a *task* id is `task-<base36>` and the *chat item* id is also
`task-<taskId>`, so a chat item id is `task-task-<base36>`. That is intentional namespacing, not a
bug, but it is worth knowing when debugging.

`result` is the generator's return value, which is exactly the object the task card's `link` is built
from. Clothing returns:

`clothing-62l72JIa.js:333-339`
```js
  return {
    itemId: m.id,
    name: m.name,
    version: m.current,
    ok: p.report.ok,
    notes: p.notes
  };
```

So `result.itemId` exists -> `link` is non-null -> the `Open in ...` button appears. If a generator
ever returned without `itemId`, the card would render with no button at all.

3D returns more:

`generator-BkAchkKU.js:275-282`
```js
  return {
    itemId: C.id,
    name: C.name,
    version: C.current,
    triangles: x.report.triangles,
    ok: x.report.ok,
    notes: x.notes
  };
```

### 4.4 How the chat message *references* the artifact

By id, and only by id. There is no url, no bytes, no version:

`index-DPVV2ya5.js:26943-26946`
```js
    link: n?.itemId ? {
      panel: t.kind === `clothing` ? `clothing` : `generator`,
      id: n.itemId
    } : null
```

The resolution back to a real artifact happens in the panel, not in the chat. When the panel opens it
looks the id up in the collection:

`ClothingPanel-CEM_quBl.js:145-154`
```js
  (0, U.useEffect)(() => {
    let t = true;
    if (e.openId) {
      L.get(e.openId).then(e => t && s(e)).catch(() => t && s(null));
    }
    return () => {
      t = false;
    };
  }, [e.openId, i]);
```

and the panel resolves `current` to a version payload:

`ClothingPanel-CEM_quBl.js:162`
```js
  let b = p ?? (f ? ne(f)?.design : null);
```

`ne` is `currentVersion` from the collection module:

`collection-DAIZY86Y.js:27-29`
```js
function f(e) {
  return e?.versions?.find(t => t.n === e.current) ?? e?.versions?.at(-1) ?? null;
}
```

### 4.5 How the chat transcript is persisted

Threads are saved through a Tauri command, with a hard cap on how much history is kept and a rewrite
that strips inline base64 in favour of `media:` handles:

`index-DPVV2ya5.js:25960-26003`
```js
function Wm(e) {
  let t = e.slice(-300);
  let n = e.findLast(e => e?.kind === `compaction`);
  if (n && !t.includes(n)) {
    t = [n, ...t];
  }
  return t.map(e => {
    let {
      image: t,
      images: n,
      streaming: r,
      ...i
    } = e?.kind === `tool` ? an(e) : e?.kind === `compaction` ? {
      ...e,
      summary: en(e.summary)
    } : e;
    let a = e => typeof e == `string` && e.startsWith(`media:`);
    return {
      ...i,
      ...(a(t) ? {
        image: t
      } : {}),
      ...(Array.isArray(n) && n.some(a) ? {
        images: n.filter(a)
      } : {})
    };
  });
}
function Gm(e) {
  let t = Fm.get(e);
  Fm.delete(e);
  clearTimeout(Pm.get(e));
  Pm.delete(e);
  if (t) {
    return j(`thread_save`, {
      placeKey: t.place,
      threadId: t.thread,
      meta: t.meta,
      items: Wm(t.items)
    }).catch(() => {});
  } else {
    return Promise.resolve();
  }
}
```

Two things matter here:

1. **Only the last 300 items are kept** (`e.slice(-300)`).
2. **Only `media:` images survive the save.** A `data:` image on a tool item is dropped, because
   `a(t)` returns false for it. That is why the `yc(...)` conversion at `index-DPVV2ya5.js:26818` is
   load-bearing: without it the tool thumbnail would be lost on reload.

And a `kind: 'task'` item has no `image`/`images` field at all, so nothing about it is filtered -
because there is nothing visual to filter.

---

## 5. Versioning: "Save as new version"

### 5.1 The button

`ClothingPanel-CEM_quBl.js:586-590`
```js
{o && <Component61 className={`cs-row-btns`}><_Component13 size={`sm`} disabled={u} onClick={() => l(null)}>{`Discard`}</_Component13><_Component14 size={`sm`} disabled={u} busy={y === `manual`} onClick={() => O(`manual`, async () => {
              await ce(e.id, Ke(o));
              l(null);
              return `Saved as a new version.`;
            })}>{`Save as new version`}</_Component14></Component61>}
```

`ce` is `saveManualDesign`:

`clothing-62l72JIa.js:435-448`
```js
async function W(e, t, n = `Edited by hand`) {
  let r = await w.get(e);
  let i = await (await N({
    withSheet: false
  }))(t);
  let a = u(r, {
    prompt: n,
    design: i.design,
    ok: i.report.ok,
    brain: null,
    note: null
  });
  return w.save(a, await P(i.design, i.canvas));
}
```

`u` is `addVersion`:

`collection-DAIZY86Y.js:30-42`
```js
function p(e, t) {
  let n = Math.max(0, ...e.versions.map(e => e.n)) + 1;
  return {
    ...e,
    updatedAt: Date.now(),
    current: n,
    versions: [...e.versions, {
      ...t,
      n,
      createdAt: Date.now()
    }]
  };
}
```

Key facts:

- **Versions are an append-only array inside `item.json`.** There is no per-version file. Each
  version object is the payload only; the *thumbnail is not versioned*.
- `current` is bumped to `max(n) + 1`, so version numbers are monotonic and never reused, even after
  a restore.
- `brain` is `null` and `note` is `null` for a manual edit - so the version history honestly records
  that no model was involved.
- The prompt is literally `Edited by hand` (default arg at `clothing-62l72JIa.js:435`).
- `withSheet: false` - the manual save **skips** the 4-panel review sheet entirely. It is not needed
  because no model will look at it.

The 3D panel has the identical button in the outliner toolbar and in the checks section:

`GeneratorPanel-BNGBBwll.js:851`
```js
        }} canHold={e => e.kind === `group` || e.kind === `boolean` || e.id === `parts`} icons={on} countLabel={`triangles`} /></Component10>{e.dirty && <Component11 className={`actions scene-panel__save`}><_Component6 size={`sm`} icon={ge} busy={o} onClick={l}>{`Save as new version`}</_Component6>
```

`GeneratorPanel-BNGBBwll.js:1829-1832`
```js
            return `Saved as a new version.`;
          })}>{`Save as new version`}</_Component6></Component73></Component74></H>}<H id={`versions`} label={`Versions`}><Component75 className={`panel panel--pad cs-section`} aria-label={`Versions`}><_Component4 title={`Versions`} hint={`Every change is kept. Restore any of them.`} /><_Component22
```

backed by `saveManualEdit`:

`generator-BkAchkKU.js:416-446`
```js
async function I(e, t) {
  let n = await l(e);
  let r = structuredClone(s(n).spec);
  for (let [e, n] of Object.entries(t)) {
    if (r.params?.[e]) {
      r.params[e].value = n;
    }
  }
  let {
    model: i,
    report: a
  } = await (await D({
    withSheet: false
  }))(r);
  let o = s(n);
  let c = o.engine === `polyforge` ? {
    engine: o.engine,
    script: o.script,
    edits: o.edits ?? null
  } : {};
  let d = f(n, {
    prompt: `Manual edit`,
    spec: r,
    triangles: a.triangles,
    ok: a.ok,
    brain: null,
    note: Object.entries(t).map(([e, t]) => `${e} = ${t}`).join(`, `),
    ...c
  });
  return u(d, await O(i, r));
}
```

Notice 3D *does* write a `note` for manual edits - the list of changed parameters - whereas clothing
does not.

### 5.2 Restore

`ClothingPanel-CEM_quBl.js:590`
```js
<_Component15 versions={e.versions} current={e.current} disabled={u} onRestore={t => le(e.id, t)} />
```

`le` is `restoreClothingVersion`:

`clothing-62l72JIa.js:449-455`
```js
async function G(e, t) {
  let n = l(await w.get(e), t);
  let r = await (await N({
    withSheet: false
  }))(c(n).design);
  return w.save(n, await P(r.design, r.canvas));
}
```

with `setCurrent`:

`collection-DAIZY86Y.js:43-47`
```js
var m = (e, t) => ({
  ...e,
  current: t,
  updatedAt: Date.now()
});
```

So restore does **not** create a new version - it moves the `current` pointer back. It *does*
re-render the thumbnail (`await P(...)`), so `thumb.png` always reflects `current`.

### 5.3 The version list UI

`InspectorTabs-B3TKlNWg.js:664-686`
```js
function Se({
  versions: e,
  current: t,
  onRestore: n,
  disabled: r,
  facts: i
}) {
  let a = [...e].sort((e, t) => t.n - e.n);
  const Component62 = `ol`;
  return <Component62 className={`cs-versions`}>{a.map(e => {
      let a = e.n === t;
      ...
      return <Component61 className={`cs-version ${a ? `cs-version--on` : ``}`} key={e.n}><Component53 className={`cs-version__n mono`}>{`v`}{e.n}</Component53><Component58 className={`min-w-0 flex-1`}><Component54 className={`cs-version__prompt`} title={e.prompt}>{e.prompt || `Untitled change`}</Component54><Component56 className={`cs-version__meta`}>{[e.brain, e.brain && e.modelName, xe(e.createdAt), i?.(e)].filter(Boolean).join(` - `)}{e.ok === false && <Component55 className={`cs-version__warn`}>{` - fails checks`}</Component55>}</Component56>{e.note && <Component57 className={`cs-version__note`}>{e.note}</Component57>}</Component58>{a ? <Component59 className={`badge badge--xs badge--outline`}>{`Current`}</Component59> : <Component60 type={`button`} className={`btn btn--sm btn--ghost cs-version__restore`} disabled={r} onClick={() => n(e.n)} title={`Make this version current again`}><E strokeWidth={1.8} />{` Restore`}</Component60>}</Component61>;
    })}</Component62>;
}
```

Each row shows: `v<n>`, the prompt, `brain`, `modelName`, the date, optional extra facts (for 3D:
`N tris`), a `fails checks` warning when `ok === false`, the `note`, and either a `Current` badge or a
`Restore` button. Newest first (`sort((e, t) => t.n - e.n)`).

### 5.4 How the chat references a *specific* version

**It does not.** This is a real limitation and it is worth stating plainly.

`link` carries `{ panel, id }` and nothing else:

`index-DPVV2ya5.js:26943-26946`
```js
    link: n?.itemId ? {
      panel: t.kind === `clothing` ? `clothing` : `generator`,
      id: n.itemId
    } : null
```

`itemId` is the item, not a version. When the panel opens it always resolves `item.current`:

`ClothingPanel-CEM_quBl.js:162`
```js
  let b = p ?? (f ? ne(f)?.design : null);
```

So if you generate `v1`, generate `v2` from the same item, then scroll back to the `v1` task card and
click `Open in Clothing Creator`, you land on **v2**, not v1. The task's own `result` does carry a
`version` field (`clothing-62l72JIa.js:336`: `version: m.current`), but `og` never copies it into the
chat item, and the panel has no way to accept one.

The only way to reach an older version is the `Versions` list in the panel and the `Restore` button.

### 5.5 What the chat item *does* remember

Three things survive, and only three:

- `title` - the prompt.
- `summary` - the `result.summary`, i.e. the tool's one-liner. For a background task this is the
  task card body text.
- `link.id` - the item id, which resolves to whatever is `current` at click time.

The version's `note` (the review log), `brain`, `modelName`, `ok` and `triangles` are all in
`item.versions[n]` on disk, but none of them reach the transcript.

---

## 6. Corrections to the user's mental model, stated explicitly

### 6.1 "It reviews / double-checks, then captures, then shows it in the chat"

The review and the capture are correct, and they are more elaborate than the user assumed:

- The review is **multi-round** (2 by default, hard-capped at 2 by `MAX_REVIEW_ROUNDS`), it is
  **model-driven**, it is shown a **rendered multi-view contact sheet**, and it can **force a full
  rebuild** (`fixing`) which re-enters `checking` with the new artifact.
- The capture is **plural**: a 256px PNG thumbnail for the library, a 1024x358 JPEG for clothing
  review, 1536x1536 JPEGs for 3D review, a 585x559 PNG atlas for upload. Which one is taken depends
  on the consumer.

The chat display is **wrong** in the way the user imagines it. Specifically:

**WRONG:** "the result appears in the chat as a viewport or preview."

**WHAT ACTUALLY HAPPENS:** a finished background generation appears in the transcript as a
**text-only card** with a kind chip, the prompt as a title, one line of summary text, and an
`Open in Clothing Creator` / `Open in 3D Generator` button. There is no image, no canvas, no
viewport, no thumbnail in that card. The artifact is rendered only after the user clicks the button
and the app switches panels.

`index-DPVV2ya5.js:40743-40779` is the whole component. Its only interactive element is
`<Component442 type={`button`} className={`btn btn--sm`} onClick={() => Qt(e.link)}>`.

### 6.2 The one case where the user is right

If the assistant calls `generate_clothing` / `generate_3d` **as a tool** instead of spawning a
background task, the tool result does carry an image, and `Ac`/`Rc` render it as a **static 256px
thumbnail** with click-to-zoom (`index-DPVV2ya5.js:17941-17961`, `18041-18072`). Even then it is
(a) a static image, never a live viewport, and (b) not the artifact itself - it is the stored
`thumb.png` from the collection.

### 6.3 "Then it captures the result" - the capture is *not* a screenshot of what the user sees

This is a subtle but important correction. The captures are **fresh offscreen renders**, produced by
a dedicated `WebGLRenderer` created with `preserveDrawingBuffer: true`:

`avatarRender-DVeE1evW.js:5-17`
```js
function u(e, t) {
  if (!l) {
    l = new s({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    l.outputColorSpace = o;
  }
  l.setPixelRatio(1);
  l.setSize(e, t, false);
  return l;
}
```

`render-D__CO5co.js:9-21`
```js
function x(e) {
  if (!b) {
    b = new u({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    b.outputColorSpace = c;
  }
  b.setPixelRatio(1);
  b.setSize(e, e, false);
  return b;
}
```

`preserveDrawingBuffer: true` is exactly what makes `toBlob`/`toDataURL` legal after `render()`. The
renderer is a **singleton module-level** variable (`l` and `b` above), resized per call, and the
scene is rebuilt from the design/spec each time. So the "capture" is a deterministic re-render, not a
grab of the live viewport. This is why the thumbnail can be regenerated at any time from
`item.versions[current].design` alone - which is precisely what `restoreClothingVersion` does
(`clothing-62l72JIa.js:449-455`).

There is **no** `canvas.captureStream` anywhere in the bundle (grep over all 166 `.js` files returns
zero hits), and **no** application-level `readPixels` - the only four hits are inside vendored
three.js (`three.module-Bt_xI7Zm.js:22765`, `:22796`, and the worker copy
`worker-DZ3hS97o.js:22776`, `:22807`). So no frame-grabbing, no video, no live stream.

### 6.4 "shown in the chat room / session"

The chat is a **session transcript**, and the thing it holds about a generation is a **reference**,
not a payload. The item id is the only link. Everything visual is re-derived on demand from disk.

This has a concrete consequence for anyone rebuilding this: to reproduce the RobloxKit behaviour you
need (1) a task queue with a `stage`/`detail` channel, (2) a per-item on-disk record with a version
array and a `thumb.png`, (3) a chat item of `kind: 'task'` carrying `{ title, summary, link: { panel, id } }`,
and (4) an `Open in ...` affordance that switches panels and resolves `current` at click time. You do
**not** need a viewport in the transcript, because RobloxKit never built one.

---

## 7. Complete pipeline, end to end, with stage ids

```
  user prompt
      |
      v
  [queueNewClothing]                       clothing-62l72JIa.js:381
      spawnTask({kind:'clothing', ...})    tasks-Rr6W1sdh.js:109
      status: 'queued', stage: 'Waiting'   tasks-Rr6W1sdh.js:127-128
      |
      v
  [task runner picks it up]                tasks-Rr6W1sdh.js:250-256
      status: 'running', stage: 'Starting' tasks-Rr6W1sdh.js:267-272
      |
      v
  +-- designLoop (Se) ------------------------------------------- gen3d-BAdfthxw.js:814
  |
  |  stage 'designing'  "Designing"  -> model call #1            :884
  |      model returns JSON design
  |
  |  stage 'building'   "Drawing"    -> deterministic build      :893-898
  |      build throws -> stage 'fixing' + retry (max 3)          :899-915
  |
  |  ROUND LOOP  e = 0 .. rounds-1  (rounds = 2)                 :918
  |  |
  |  |  stage 'checking' "Checking"                              :919-922
  |  |     capture: renderClothingSheet -> 1024x358 JPEG 0.85    avatarRender-DVeE1evW.js:63
  |  |     review msg = lead + facts + layout + question          :934-938
  |  |     attached image = the sheet  (if vision && brain takes images)
  |  |     model replies DONE, or a whole new design
  |  |     |
  |  |  +-- if DONE:
  |  |  |     if report.ok  -> accept hook (may refuse)           :958-967
  |  |  |     if !report.ok -> bounce with the error list         :962-963
  |  |  |     bounce loop max 2                                   :957
  |  |  |
  |  |  +-- if new design:
  |  |        stage 'fixing' "Fixing" -> rebuild                   :981-989
  |  |        rebuild fails -> retry max 2                         :990-1003
  |  |        rebuild ok    -> loop again with the new artifact
  |  |
  |  +-- vision refused -> drop to text-only, note it              :942-953
  |
  +---------------------------------------------------------------> returns {result, built, notes}
      |
      v
  stage 'Saving'                                                  clothing-62l72JIa.js:305
      capture: renderClothingThumbnail -> 256x256 PNG             avatarRender-DVeE1evW.js:49
      item = { id, name, type, prompt, current:1, versions:[...] } clothing-62l72JIa.js:313
      save -> Documents/RobloxKit/clothing/collection/<id>/
                 item.json                                        collection-DAIZY86Y.js:108
                 thumb.png                                        collection-DAIZY86Y.js:110
      |
      v
  task status 'done', stage 'Done'                                tasks-Rr6W1sdh.js:293-296
      result = { itemId, name, version, ok, notes }
      |
      +--> onTaskFinished listeners                                tasks-Rr6W1sdh.js:240-244
      |       -> reportTask(origin, task)                          index-DPVV2ya5.js:42304-42307
      |       -> og(scope, task)                                   index-DPVV2ya5.js:26926
      |       -> chat item {kind:'task', title, summary, link}     index-DPVV2ya5.js:26935
      |       -> transcript renders _Component54 (text card)       index-DPVV2ya5.js:40743
      |
      +--> user clicks "Open in Clothing Creator"                  index-DPVV2ya5.js:40771
              -> Qt(link) -> te({panel, id})                       acp-C1bBXu3Z.js:222
              -> openInClothing(id)                                clothing-62l72JIa.js:195
              -> 'robloxkit:open-panel' event                      clothing-62l72JIa.js:200
              -> app switches panel                                index-DPVV2ya5.js:42466-42470
              -> panel loads item, resolves current version        ClothingPanel-CEM_quBl.js:148
              -> renders Preview3D (avatar) or flat template       ClothingPanel-CEM_quBl.js:351
```

---

## 8. Every citation, indexed

### Generator loop
- `gen3d-BAdfthxw.js:415-432` - exported names incl. `MAX_REVIEW_ROUNDS: () => 2`, `designLoop: () => Z`
- `gen3d-BAdfthxw.js:527-528` - `ge = 2` (review rounds), `_e = 3` (build retries)
- `gen3d-BAdfthxw.js:771-813` - `Z` (designLoop), model-choice resolution + `finally` cleanup
- `gen3d-BAdfthxw.js:814-836` - `Se` signature with `rounds = 2`, `vision = true`
- `gen3d-BAdfthxw.js:837-843` - initial history `S`
- `gen3d-BAdfthxw.js:845-883` - `w`, the model call wrapper with connection-drop retry
- `gen3d-BAdfthxw.js:884` - `designing` stage
- `gen3d-BAdfthxw.js:888-916` - `building` stage + build-rejection loop
- `gen3d-BAdfthxw.js:917-938` - `checking` stage, sheet attach, review message assembly
- `gen3d-BAdfthxw.js:939-954` - vision-refusal fallback
- `gen3d-BAdfthxw.js:955-978` - DONE acceptance / bounce loop
- `gen3d-BAdfthxw.js:979-1008` - `fixing` rebuild loop
- `gen3d-BAdfthxw.js:1015` - `Q = 2` connection retries
- `gen3d-BAdfthxw.js:1023-1038` - `we`, "does this brain take images"
- `clothing-62l72JIa.js:130-135` - clothing `review` callback
- `clothing-62l72JIa.js:272-277` - clothing stage labels
- `clothing-62l72JIa.js:278-304` - `L`, the clothing task handler, `onStage` wiring
- `clothing-62l72JIa.js:305-339` - `Saving` + item construction
- `generator-BkAchkKU.js:203-208` - 3D stage labels
- `generator-BkAchkKU.js:234-238` - 3D `onStage` wiring
- `generator-BkAchkKU.js:256` - 3D `Saving`
- `generator-BkAchkKU.js:275-282` - 3D task result
- `gen3d-BAdfthxw.js:745-753` - 3D `review` callback
- `generate-BwNaPC_j.js:541-549` - Polyforge scored review prompt
- `generate-BwNaPC_j.js:550-566` - Polyforge `accept` validator
- `generate-BwNaPC_j.js:648-649` - Polyforge `rounds = 4`
- `tasks-Rr6W1sdh.js:109-154` - `spawnTask`
- `tasks-Rr6W1sdh.js:250-308` - scheduler + `F` (run one task)
- `tasks-Rr6W1sdh.js:273-288` - `report` (the stage setter)
- `tasks-Rr6W1sdh.js:293-296` - `done` + `stage: 'Done'`
- `tasks-Rr6W1sdh.js:20-21`, `:78-88` - `tasks.json`, 20000-char result cap

### Capture
- `avatarRender-DVeE1evW.js:5-17` - singleton WebGLRenderer, `preserveDrawingBuffer: true`
- `avatarRender-DVeE1evW.js:33-39` - camera directions incl. `'3/4': [0.75, 0.25, 1]`
- `avatarRender-DVeE1evW.js:49-62` - `renderClothingThumbnail`, 256x256 PNG bytes
- `avatarRender-DVeE1evW.js:63-96` - `renderClothingSheet`, 1024x358 JPEG 0.85
- `avatarRender-DVeE1evW.js:97` - export line
- `render-D__CO5co.js:9-21` - 3D renderer singleton
- `render-D__CO5co.js:78-91` - `renderThumbnail`, 256x256 PNG bytes
- `render-D__CO5co.js:92-134` - `renderViewSheet`, JPEG 0.85
- `render-D__CO5co.js:135-228` - `renderReviewSheets`, JPEG 0.88, 2 sheets
- `render-D__CO5co.js:262` - export line
- `render-CpljO1Hx.js:350-354` - `renderPng` (flat atlas), PNG bytes
- `layout-yFs0_M_2.js:74-86` - atlas dimensions 585x559 / 512x512
- `gfx-CVkb5YLh.js:241-263` - GFX sheet, JPEG 0.85
- `icons-BpUOWggy.js:62-99` - icon sheet (PNG) + thumbnail (PNG 256)
- `sfx-C9VkZ_Hq.js:147-171` - SFX sheet + thumbnail
- `render-CzBncmsu.js:113-136` - VFX sheet (JPEG 0.85) + thumbnail (PNG 256)
- `render-Ej67xP5V.js:997-1021` - texture sheet (PNG)
- `sheet-DVAmNjwR.js:66-135` - animation sheet (PNG)
- `music-DejM99vB.js:1360-1379` - music timeline thumbnail (PNG 256)
- `collection-DAIZY86Y.js:103-115` - `thumbnail()` + `save()` writing `thumb.png` / `item.json`
- `workspaceTools-oYxH4nqo.js:17`, `:103-105` - workspace root `RobloxKit`
- `dist-js-BHTFfXLT.js:29-33`, `:39-64` - Tauri fs plugin (`Document` dir)
- `index-DPVV2ya5.js:17779` - `media:` prefix test
- `index-DPVV2ya5.js:17795-17811` - `yc` -> `media_put`
- `index-DPVV2ya5.js:17814-17823` - `media_get` -> blob URL
- `index-DPVV2ya5.js:24786-24805` - `capture_viewport` (Studio screenshot, separate path)

### Transcript embed
- `index-DPVV2ya5.js:40509` - the seven transcript kinds
- `index-DPVV2ya5.js:40510-40537` - `rD`, tool fanning
- `index-DPVV2ya5.js:40604-40652` - `_Component41`, the message dispatcher
- `index-DPVV2ya5.js:40629-40632` - `assistant` rendering (markdown only)
- `index-DPVV2ya5.js:40640-40641` - `task` -> `_Component54`
- `index-DPVV2ya5.js:40649-40650` - fallback -> `Oc` (tool card)
- `index-DPVV2ya5.js:40743-40779` - `_Component54`, the text-only task card
- `index-DPVV2ya5.js:17941-17961` - `Ac`, the tool card
- `index-DPVV2ya5.js:18041-18072` - `Rc`, thumbnail strip + zoom
- `index-DPVV2ya5.js:18073-18085` - `_Component31`, `<img>` with resolved src
- `index-DPVV2ya5.js:17856-17883` - `Tc`, blob URL resolution
- `index-DPVV2ya5.js:39933-39936` - `zE`, which srcs count as images
- `index-DPVV2ya5.js:40025-40031` - markdown `img` renderer
- `index-DPVV2ya5.js:26818-26823` - `data:` -> `media:` conversion on tool results
- `acp-C1bBXu3Z.js:222-249` - `te`, the `Open in ...` dispatcher
- `clothing-62l72JIa.js:195-205` - `openInClothing`
- `index-DPVV2ya5.js:42464-42470` - `open-panel` listener

### Data shape
- `index-DPVV2ya5.js:26926-26956` - `og`, chat item construction
- `index-DPVV2ya5.js:26943-26946` - `link: { panel, id }`
- `collection-DAIZY86Y.js:26` - item id generator
- `collection-DAIZY86Y.js:27-29` - `currentVersion`
- `collection-DAIZY86Y.js:30-42` - `addVersion`
- `collection-DAIZY86Y.js:43-47` - `setCurrent`
- `collection-DAIZY86Y.js:179-202` - `createItem`
- `clothing-62l72JIa.js:258-271` - `F`, the clothing version payload
- `clothing-62l72JIa.js:312-331` - clothing item construction
- `clothing-62l72JIa.js:333-339` - clothing task result
- `clothing-62l72JIa.js:356-380` - `z`, task spawn with `title` = prompt
- `generator-BkAchkKU.js:182-202` - 3D version payload (incl. `note` = review log)
- `tasks-Rr6W1sdh.js:119-136` - task record
- `index-DPVV2ya5.js:25960-26003` - `Wm`/`Gm`, thread persistence, 300-item cap, `media:` filter

### Versioning
- `ClothingPanel-CEM_quBl.js:586-590` - `Save as new version` button
- `ClothingPanel-CEM_quBl.js:590` - `Versions` section
- `ClothingPanel-CEM_quBl.js:162` - panel resolves `current`
- `ClothingPanel-CEM_quBl.js:148` - panel loads item by id
- `clothing-62l72JIa.js:435-448` - `saveManualDesign`
- `clothing-62l72JIa.js:449-455` - `restoreClothingVersion`
- `GeneratorPanel-BNGBBwll.js:851` - 3D `Save as new version` (outliner)
- `GeneratorPanel-BNGBBwll.js:1829-1832` - 3D `Save as new version` (checks section)
- `generator-BkAchkKU.js:416-446` - `saveManualEdit`
- `generator-BkAchkKU.js:447-456` - `restoreVersion`
- `InspectorTabs-B3TKlNWg.js:664-686` - `Se`, the versions list

### Absences (verified by exhaustive grep over all 166 bundle files)
- `indexedDB` - only in sandbox deny-lists: `run-CxH39Tsb.js:1095`, `:1134`, `worker-DZ3hS97o.js:36887`, `:36926`
- `captureStream` - **zero hits**
- `readPixels` - only vendored three.js: `three.module-Bt_xI7Zm.js:22765`, `:22796` and the worker
  copy `worker-DZ3hS97o.js:22776`, `:22807`. No application-level use.
- `Preview3D` imported by the chat renderer - **zero hits**. Imported by exactly three files:
  `ClothingPanel-CEM_quBl.js:22`, `GeneratorPanel-BNGBBwll.js:25`, `TexturePanel-D8uJ3dDt.js:19`.
  (`index-DPVV2ya5.js:1` merely lists `assets/Preview3D-CIiMrTBA.js` in the Vite dependency manifest
  `__vite__mapDeps`; it is not an import. `SkyboxPanel-Dol3AjLh.js:325` renders the same
  `preview3d` class but imports `Viewport-D1Bi_VWL.js` directly at line 8, not `Preview3D`.)
- `media_put` call sites - exactly one: `index-DPVV2ya5.js:17806`
- `screen_capture` call sites - exactly one: `index-DPVV2ya5.js:24792`
