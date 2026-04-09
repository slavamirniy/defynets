# defynets

**A declarative DSL that replaces TypeScript generic gymnastics with readable schema definitions.**

Instead of `[K in keyof T]: T[K] extends ...` — write `$.map`, `$.ref`, `$.access`.
Same type safety. Zero generic parameters. Reads like a spec.

**[▶ Try it in the Playground](https://playcode.io/typescript-playground--019d743c-5bb6-77cf-a769-e130cdfd66dc)**

```bash
npm i git+https://github.com/slavamirniy/defynets.git
```

---

## The idea

TypeScript generics are powerful. But when types **depend on each other**, things spiral fast:

```typescript
function createAPI<
    T extends Record<string, { request: unknown; response: unknown }>,
    H extends { [K in keyof T]: (req: T[K]["request"]) => T[K]["response"] },
    M extends { [K in keyof T]: (req: T[K]["request"]) => T[K]["request"] },
>(endpoints: T, handlers: H, middleware: M) { ... }
```

Three generic parameters. Three mapped types. Everything passed at once. Adding a fourth concern means yet another generic and yet another mapped type.

`defynets` replaces this with a **declarative schema**:

```typescript
import { schema, ty } from "defynets";

const API = schema()
    .field("endpoints", ty.record(ty.object({
        request: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.map($.ref("endpoints"), e =>
        $.fn(e.request, e.response),
    ))
    .field("middleware", $ => $.map($.ref("endpoints"), e =>
        $.fn(e.request, e.request),
    ))
    .done();
```

Read it: *"Endpoints have request/response descriptors. Handlers map each endpoint to request → response. Middleware maps each endpoint to request → request."*

That's **architecture as code**. The builder enforces dependency order, provides per-field autocomplete, and catches every mismatch at compile time. Adding validation? One more `.field()` — zero existing code changed.

---

## The builder computes the dependency tree

Every `$.ref()` declares a dependency. The builder analyzes the graph and **progressively reveals** `defineX()` methods — you only see what you can define right now.

```typescript
const App = schema()
    //        field             depends on
    .field("roles",       ty.array(ty.string))                                          // —
    .field("theme",       ty.string)                                                    // —
    .field("permissions", $ => $.record($.keysOf($.ref("roles")), $.type<boolean>()))    // roles
    .field("welcome",     $ => $.ref("theme"))                                          // theme
    .field("summary",     $ => $.fn($.ref("permissions"), $.string))                    // permissions
    .done();
```

Now watch the builder guide you through the dependency levels:

```typescript
const app = App
    // ┌ Available: defineRoles, defineTheme
    // │ Hidden:    definePermissions (needs roles)
    // │            defineWelcome (needs theme)
    // │            defineSummary (needs permissions)
    .defineRoles(["admin", "editor"])

    // ┌ Available: defineTheme, definePermissions  ← unlocked!
    // │ Hidden:    defineWelcome (needs theme)
    // │            defineSummary (needs permissions)
    .defineTheme("dark")

    // ┌ Available: definePermissions, defineWelcome  ← unlocked!
    // │ Hidden:    defineSummary (needs permissions)
    .definePermissions({ admin: true, editor: false })

    // ┌ Available: defineWelcome, defineSummary  ← unlocked!
    .defineWelcome("dark")
    .defineSummary((perms) => `${JSON.stringify(perms)}`)

    // All fields defined → build() returns the result
    .build();
```

No manual ordering. No runtime errors. The **type system itself** enforces the correct construction sequence. Try calling `.definePermissions` before `.defineRoles` — it simply doesn't exist in autocomplete.

---

## Real systems in a few lines

### Finite State Machine

```typescript
const Machine = schema()
    .field("states", ty.record(ty.object({
        on: ty.record(ty.string),
        data: ty.desc,
    })))
    .field("logic", $ => $.map($.ref("states"), state => $.object({
        send: $.fn($.keysOf(state.on), ty.type<void>()),
        render: $.fn(state.data, ty.string),
    })))
    .done();
```

10 lines. A complete type-safe FSM:
- Each state has its own event set and data shape
- `send()` only accepts events declared for that specific state
- `render()` receives the correct data type per state

```typescript
const light = Machine
    .defineStates({
        red:    { on: { TIMER: "green" },  data: ty.object({ carsWaiting: ty.number }) },
        green:  { on: { TIMER: "yellow" }, data: ty.object({ carsPassed: ty.number }) },
        yellow: { on: { TIMER: "red" },    data: ty.type<null>() },
    })
    .defineLogic({
        red: {
            send: (event) => { /* event: "TIMER" — the only event red accepts */ },
            render: (data) => `Red: ${data.carsWaiting} cars waiting`,
        },
        green: {
            send: (event) => {},
            render: (data) => `Green: ${data.carsPassed} passed`,
        },
        yellow: {
            send: (event) => {},
            render: () => `Yellow: slow down`,
        },
    })
    .build();
```

Or build step by step with inner builders — dict fields use `.entry(key, value).done()`:

```typescript
const light = Machine
    .defineStates(b => b
        .entry("red",    { on: { TIMER: "green" },  data: ty.object({ carsWaiting: ty.number }) })
        .entry("green",  { on: { TIMER: "yellow" }, data: ty.object({ carsPassed: ty.number }) })
        .entry("yellow", { on: { TIMER: "red" },    data: ty.type<null>() })
        .done()
    )
    .defineLogic({...})
    .build();
```

### Type-Safe Pipeline

```typescript
const Pipeline = schema()
    .field("registry", ty.record(ty.desc))
    .field("steps", $ => $.array(ty.object({
        from: $.keysOf($.ref("registry")),
        to:   $.keysOf($.ref("registry")),
    })))
    .field("handlers", $ => $.map($.ref("steps"), step =>
        $.fn(
            $.access($.ref("registry"), step.from),
            $.access($.ref("registry"), step.to),
        ),
    ))
    .done();
```

Each handler's input/output types are resolved from the registry automatically:

```typescript
const nlp = Pipeline
    .defineRegistry({
        rawText:   ty.string,
        tokens:    ty.array(ty.string),
        wordCount: ty.number,
    })
    .defineSteps([
        { from: "rawText", to: "tokens" },
        { from: "tokens", to: "wordCount" },
    ])
    .defineHandlers([
        (text) => text.split(" "),    // string → readonly string[]
        (tokens) => tokens.length,     // readonly string[] → number
    ])
    .build();
```

### Dynamic Form Builder

```typescript
const TypedForm = schema()
    .field("typeMap", ty.record(ty.desc))
    .field("fields", $ => $.record($.keysOf($.ref("typeMap"))))
    .field("values", $ => $.map($.ref("fields"), field =>
        $.access($.ref("typeMap"), field),
    ))
    .done();
```

6 lines. Each form field's value type is resolved dynamically from a type catalog:

```typescript
const form = TypedForm
    .defineTypeMap({ string: ty.string, number: ty.number, boolean: ty.boolean })
    .defineFields({ username: "string", age: "number", active: "boolean" })
    .defineValues({
        username: "alice",  // ← string ✓
        age: 28,            // ← number ✓
        active: true,       // ← boolean ✓
    })
    .build();
```

---

## From basics to power patterns

### Step 1: Describing types

`schema()` + `ty.*` — describe what your data looks like:

```typescript
import { schema, ty } from "defynets";

const Config = schema()
    .field("host", ty.string)
    .field("port", ty.number)
    .field("database", ty.object({
        url: ty.string,
        pool: ty.number,
    }))
    .field("tags", ty.array(ty.string))
    .field("debug", ty.boolean)
    .done();

const config = Config
    .defineHost("localhost")
    .definePort(3000)
    .defineDatabase({ url: "postgres://localhost/dev", pool: 5 })
    .defineTags(["auth", "logging"])
    .defineDebug(true)
    .build();
```

Remove `.definePort()` — `build()` disappears from autocomplete. Pass a string to `.definePort()` — compile error. No class, no runtime checks.

Every `defineX()` also accepts a **callback with an inner builder** — for objects, arrays, and dicts:

```typescript
const config = Config
    .defineHost("localhost")
    .definePort(3000)
    .defineDatabase(b => b          // ObjStepBuilder — field by field
        .defineUrl("postgres://localhost/dev")
        .definePool(5)
        .build()
    )
    .defineTags(b => b              // ArrStepBuilder — element by element
        .add("auth")
        .add("logging")
        .done()
    )
    .defineDebug(true)
    .build();
```

Objects get `b.defineX(v).build()`. Arrays get `b.add(v).done()`. Dicts get `b.entry(key, v).done()`. This is especially powerful for recursive structures and nested schemas.

---

### Step 2: Fields that reference each other — `$.ref`, `$.keysOf`, `$.record`

Fields can depend on other fields. The builder only shows `defineX()` when X's dependencies are satisfied.

**Without defynets:**

```typescript
function createSystem<F extends Record<string, boolean>>(
    features: F,
    descriptions: { [K in keyof F]: string },
) {
    return { features, descriptions };
}
// features and descriptions must be passed at the same time.
// Can't define features first, do something else, then add descriptions.
```

**With defynets:**

```typescript
const System = schema()
    .field("features", ty.object({
        darkMode: ty.boolean,
        analytics: ty.boolean,
    }))
    .field("descriptions", $ => $.record($.keysOf($.ref("features")), $.string))
    .done();

const sys = System
    .defineFeatures({ darkMode: true, analytics: false })
    // ↓ defineDescriptions appears — keys constrained to "darkMode" | "analytics"
    .defineDescriptions({
        darkMode:  "Dark color scheme",
        analytics: "Usage tracking",
        // typo: "..."  ← TS error: not a key of features
    })
    .build();
```

`$.ref("features")` creates a dependency. `$.keysOf(...)` extracts the keys. `$.record(keys, valueType)` builds a constrained dictionary.

**Keys from arrays — no `as const` needed:**

```typescript
const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => $.record($.keysOf($.ref("roles")), $.type<boolean>()))
    .done();

const rbac = RBAC
    .defineRoles(["admin", "editor", "viewer"])
    // ↓ keys: exactly "admin" | "editor" | "viewer"
    .definePermissions({ admin: true, editor: true, viewer: false })
    .build();
```

No `as const`. Roles defined first → permission keys inferred from the actual values.

**Keys from a single string:**

```typescript
const Tenant = schema()
    .field("name", ty.string)
    .field("quota", $ => $.record($.keysOf($.ref("name")), $.number))
    .done();

Tenant
    .defineName("acme")
    .defineQuota({ acme: 42 })   // ← exactly one key: "acme"
    .build();
```

---

### Step 3: Per-key projection — `$.map`

The most powerful feature. Instead of a uniform value type, **each key gets its own type** derived from the source entry.

**Without defynets:**

```typescript
type Handlers<T extends Record<string, { input: unknown; output: unknown }>> = {
    [K in keyof T]: (input: T[K]["input"]) => T[K]["output"]
};
```

**With defynets:**

```typescript
.field("handlers", $ => $.map($.ref("endpoints"), e =>
    $.fn(e.request, e.response),
))
```

`e.request` means *"the request field of the current entry."* For `getUser`, that's `{ id: string }`. For `listUsers`, that's `{ page: number }`. Each handler gets **its own signature**. The mapped type is expressed as a **relationship**, not type-level code.

Full example:

```typescript
const API = schema()
    .field("endpoints", ty.record(ty.object({
        request: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.map($.ref("endpoints"), e =>
        $.fn(e.request, e.response),
    ))
    .done();

const api = API
    .defineEndpoints({
        getUser:   { request: ty.type<{ id: string }>(),   response: ty.type<{ name: string }>() },
        listUsers: { request: ty.type<{ page: number }>(), response: ty.type<{ users: string[] }>() },
    })
    .defineHandlers({
        getUser:   (req) => ({ name: `User ${req.id}` }),
        //          ^^^ req: { id: string } — inferred from getUser.request
        listUsers: (req) => ({ users: [`page${req.page}`] }),
        //          ^^^ req: { page: number } — inferred from listUsers.request
    })
    .build();
```

**Map over array with deep path:**

```typescript
const ArrayPipeline = schema()
    .field("tasks", ty.array(ty.object({
        name: ty.string,
        input: ty.desc,
        output: ty.desc,
    })))
    .field("processors", $ => $.map($.ref("tasks").name, e =>
        $.fn(e.input, e.output),
    ))
    .done();
```

`$.ref("tasks").name` — keys come from the `name` field of each array element. The entry callback gives access to each element's other fields.

---

### Step 4: Type catalog — `$.access`

Define types once, reference everywhere. `$.access` resolves a type from a registry by key — a **type-level join**.

**Without defynets:**

```typescript
type ResolveMethods<
    Types extends Record<string, unknown>,
    Methods extends Record<string, { input: keyof Types; output: keyof Types }>,
> = {
    [K in keyof Methods]: (
        input: Types[Methods[K]["input"]],
    ) => Types[Methods[K]["output"]]
};
// Already hard to read — and this is simplified.
```

**With defynets:**

```typescript
const API = schema()
    .field("types", ty.record(ty.desc))
    .field("methods", $ => $.record($.object({
        input:  $.keysOf($.ref("types")),
        output: $.keysOf($.ref("types")),
    })))
    .field("handlers", $ => $.map($.ref("methods"), method =>
        $.fn(
            $.access($.ref("types"), method.input),
            $.access($.ref("types"), method.output),
        ),
    ))
    .done();

const api = API
    .defineTypes({
        user:    ty.object({ id: ty.number, name: ty.string }),
        balance: ty.object({ userId: ty.number, amount: ty.number }),
    })
    .defineMethods({
        getUser:    { input: "user",    output: "user" },
        getBalance: { input: "user",    output: "balance" },
    })
    .defineHandlers({
        getUser:    (u) => ({ id: u.id, name: u.name.toUpperCase() }),
        //           ^^ { id: number, name: string } — resolved from "user" type
        getBalance: (u) => ({ userId: u.id, amount: 100 }),
        //           ^^ { id: number, name: string } — from "user"
        //              returns { userId: number, amount: number } — from "balance"
    })
    .build();
```

`method.input` is `"user"`. `$.access($.ref("types"), method.input)` resolves to the actual `{ id: number, name: string }` type.

---

### Step 5: Nested schemas

Schemas can embed other schemas as fields. Internal dependencies stay inside. Types propagate across nesting levels.

**Without defynets:**

```typescript
function createApp<T extends Record<string, EventDef>>(
    core: ReturnType<typeof createCore<T>>,
    loggers: { [K in keyof T]: (payload: T[K]["payload"]) => string },
) { ... }
// Every module adds generics. Doesn't scale.
```

**With defynets:**

```typescript
const Core = schema()
    .field("events", ty.record(ty.object({
        payload: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.map($.ref("events"), event =>
        $.fn(event.payload, event.response),
    ));

const App = schema()
    .field("core", Core)
    .field("loggers", $ => $.map($.ref("core").events, event =>
        $.fn(event.payload, ty.string),
    ))
    .done();
```

`$.ref("core").events` reaches into the nested schema. Building it — `defineCore` opens an inner SmartBuilder with its own dependency tracking:

```typescript
const app = App
    .defineCore(b => b
        .defineEvents({
            order: {
                payload: ty.object({ userId: ty.string, total: ty.number }),
                response: ty.object({ orderId: ty.string }),
            },
        })
        .defineHandlers({
            order: (ev) => ({ orderId: `ORD-${ev.userId}` }),
        })
        .build()
    )
    .defineLoggers({
        order: (ev) => `Order from ${ev.userId}: $${ev.total}`,
        //      ^^^ payload type propagated from core → events → order
    })
    .build();
```

Internal deps (handlers → events) stay inside — they don't leak. Nesting is recursive — schemas can embed schemas that embed schemas.

---

### Step 6: Recursion — `$.self()` and `ty.self()`

Two kinds of self-reference for recursive types.

**`$.self()` — schema-level**: references the full schema output.

```typescript
const Tree = schema()
    .field("nodeId", ty.string)
    .field("children", $ => $.array($.self()))
    .done();
```

Children have the same type as the full schema output — `{ nodeId: string, children: ... }[]`. Pass a literal:

```typescript
const tree = Tree
    .defineNodeId("root")
    .defineChildren([
        { nodeId: "child-1", children: [] },
        { nodeId: "child-2", children: [
            { nodeId: "grandchild", children: [] },
        ] },
    ])
    .build();
```

Or use inner builders — **each `.add()` callback receives a full SmartBuilder for the schema**, so you can build the tree programmatically:

```typescript
const tree = Tree
    .defineNodeId("root")
    .defineChildren(b => b
        .add(b => b
            .defineNodeId("chapter-1")
            .defineChildren(b => b
                .add(b => b.defineNodeId("section-1.1").defineChildren([]).build())
                .add(b => b.defineNodeId("section-1.2").defineChildren([]).build())
                .done()
            )
            .build()
        )
        .add(b => b
            .defineNodeId("chapter-2")
            .defineChildren([])
            .build()
        )
        .done()
    )
    .build();
```

The pattern: `ArrStepBuilder.add()` → callback → `SmartBuilder` → recursive `.defineChildren()` → `ArrStepBuilder.add()` → ... all the way down, fully typed.

**`ty.self()` — object-level**: references the current `ty.object()` shape, not the full schema.

```typescript
const UI = schema()
    .field("root", ty.object({
        type: ty.string,
        props: ty.record(ty.oneOf(ty.string, ty.number)),
        children: ty.array(ty.self()),
    }))
    .done();
```

Pass a literal:

```typescript
const ui = UI
    .defineRoot({
        type: "Container",
        props: { direction: "column", padding: 16 },
        children: [{
            type: "Text",
            props: { content: "Hello" },
            children: [],
        }],
    })
    .build();
```

Or build with inner builders — **ObjStepBuilder + ArrStepBuilder + DictStepBuilder**, all recursive:

```typescript
const ui = UI
    .defineRoot(b => b
        .defineType("Container")
        .defineProps(b => b.entry("direction", "column").entry("padding", 16).done())
        .defineChildren(b => b
            .add(b => b
                .defineType("Text")
                .defineProps(b => b.entry("content", "Hello").done())
                .defineChildren([])
                .build()
            )
            .add(b => b
                .defineType("Button")
                .defineProps(b => b.entry("label", "Click").done())
                .defineChildren(b => b
                    .add(b => b
                        .defineType("Icon")
                        .defineProps(b => b.entry("name", "arrow").done())
                        .defineChildren([])
                        .build()
                    )
                    .done()
                )
                .build()
            )
            .done()
        )
        .build()
    )
    .build();
```

`ty.self()` inside the object refers to *that specific object shape*, not the entire schema. Inner builders work at every level: `.defineProps()` uses DictStepBuilder (`.entry().done()`), `.defineChildren()` uses ArrStepBuilder (`.add().done()`), each child uses ObjStepBuilder (`.defineX().build()`).

---

## Inner builders

Every `defineX()` accepts a value **or** a callback with a step-builder:

```typescript
// Dict → b.entry(key, value).done()
.defineTasks(b => b
    .entry("resize", { input: ty.type<Img>(), output: ty.type<Img>() })
    .entry("compress", { ... })
    .done()
)

// Array → b.add(value).done()
.definePipeline(b => b
    .add({ task: "resize", worker: "gpu" })
    .add({ task: "compress", worker: "cpu" })
    .done()
)

// Object → b.defineX(v).build()
.defineDatabase(b => b
    .defineUrl("postgres://...")
    .definePool(5)
    .build()
)

// Nested schema → b.defineX(v).build()
.defineCore(b => b
    .defineEvents({...})
    .defineHandlers({...})
    .build()
)
```

The second argument `ctx` gives access to already defined fields:

```typescript
.defineOrchestrator((b, ctx) => b
    .defineContracts(ctx.worker.contracts)
    .defineFlows({...})
    .build()
)
```

---

## Error messages

`build()` is always visible. When fields are missing, it tells you what:

```typescript
builder.build
//      ^^^^^ BuildNotReady<"handlers" | "middleware">
//             _missing: "handlers" | "middleware"
```

Methods with unmet deps don't show in autocomplete — no noise.

---

## The `ty` DSL

| Helper | What it does |
|--------|-------------|
| `ty.string`, `ty.number`, `ty.boolean` | Primitives |
| `ty.type<T>()` | Explicit TypeScript type |
| `ty.desc` | Type descriptor — resolved at build time |
| `ty.object({ k: ty.* })` | Nested object shape |
| `ty.array(el)` | Readonly array |
| `ty.record(valueType)` | Free-key dictionary |
| `ty.fn(in, out)` | Function type |
| `ty.nullable(inner)` | `T \| null` |
| `ty.merge(a, b)` | `A & B` |
| `ty.oneOf(a, b)` | `A \| B` |
| `ty.promise(inner)` | `Promise<T>` |
| `ty.self()` | Recursive self-reference (inside `ty.object`) |

## The `$` DSL (inside field callbacks)

| Method | What it does |
|--------|-------------|
| `$.ref("field")` | Reference another field. Supports deep path chaining: `$.ref("core").events` |
| `$.self()` | Schema-level self-reference (entire schema output) |
| `$.map(source, e => ...)` | Per-key projection over dict/array |
| `$.keysOf(tag)` | Extract keys: string → itself, array → elements, object → `keyof` |
| `$.valuesOf(tag)` | Extract values from a type |
| `$.access(tag, key)` | Type-level field access by key. Unwraps `TypeTag` automatically |
| `$.record(valueType)` | Free-key dictionary |
| `$.record(keys, valueType)` | Constrained-key dictionary |
| `$.fn(in, out)` | Function type |
| `$.object({ ... })` | Nested object shape |
| `$.array(el)` | Readonly array |
| `$.merge(a, b)` | `A & B` |
| `$.oneOf(a, b)` | `A \| B` |
| `$.nullable(inner)` | `T \| null` |
| `$.promise(inner)` | `Promise<T>` |
| `$.type<T>()` | Explicit TypeScript type |
| `$.string`, `$.number`, `$.boolean`, `$.desc` | Primitives |

## API

| Function | What it does |
|----------|-------------|
| `schema()` | Start schema → `.field()` chain → `.done()` |
| `MakeBuilder<T>()` | Simple builder from any interface (no dependencies) |
| `defineSchema(desc)` | Builder from flat `ty.*` descriptor |

| Schema method | What it does |
|---------------|-------------|
| `.field(name, ty.*)` | Declare a typed field |
| `.field(name, $ => ...)` | Declare a field with cross-references |
| `.field(name, SchemaDef)` | Embed another schema as a nested field |
| `.done()` | Finalize → SmartBuilder |

---

## Examples

Progressive — [`examples/`](./examples):

| # | File | What it shows |
|---|------|---------------|
| 1 | [01-hello-world.ts](examples/01-hello-world.ts) | Schema basics with `ty.*` |
| 2 | [02-dependencies.ts](examples/02-dependencies.ts) | `$.ref`, `$.keysOf`, `$.record`, `$.merge`, `$.map` |
| 3 | [03-dict-patterns.ts](examples/03-dict-patterns.ts) | Five ways to derive dict keys |
| 4 | [04-projections.ts](examples/04-projections.ts) | Per-key projections with `$.map`, inner builders |
| 5 | [05-full-pipeline.ts](examples/05-full-pipeline.ts) | Complete multi-level system |
| 6 | [06-meta-framework.ts](examples/06-meta-framework.ts) | Nested schemas, modular composition |
| 7 | [07-type-catalog.ts](examples/07-type-catalog.ts) | Type catalog with `$.access` |
| 8 | [08-fsm-pipeline-worker.ts](examples/08-fsm-pipeline-worker.ts) | FSM, pipeline, worker queue |
| 9 | [09-recursion-and-advanced.ts](examples/09-recursion-and-advanced.ts) | `$.self()`, `ty.self()`, graphs, dynamic form builder |
| 10 | [10-playground.ts](examples/10-playground.ts) | RPC + recursive workflows + component system — all features combined |

---

MIT
