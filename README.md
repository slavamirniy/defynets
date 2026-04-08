# defynets

**Types first. Dependencies second. Implementations last.**

```bash
npm i git+https://github.com/slavamirniy/defynets.git
```

---

## The idea

TypeScript is powerful. But in practice, you still write **code first** and then fight the type system to make it safe. Generics get out of hand. Builder classes are boilerplate. Config objects lose type connections.

`defynets` flips this. You describe **what your system looks like** — types, shapes, and how they depend on each other. The library gives you a builder that **guides the implementor** through the correct construction, step by step, with full inference at every point.

You don't write builders. You don't write generics. You write a **schema** — and TypeScript becomes a declarative configuration system.

---

## Step 1: A builder appears

Start simple. You have an interface — you want a builder for it.

```typescript
import { MakeBuilder } from "defynets";

const server = MakeBuilder<{
    host: string;
    port: number;
    debug: boolean;
}>()
    .defineHost("localhost")
    .definePort(3000)
    .defineDebug(true)
    .build();
```

That's it. No class, no constructor, no manual `build()` validation. Remove `definePort()` — and `build()` disappears from autocomplete. Pass a string to `definePort()` — compile error.

But this is just the surface. It gets interesting when fields start **talking to each other**.

---

## Step 2: Fields that depend on each other

Real systems aren't flat. A database pool needs a connection string. A session store needs a cache URL. Things have **order**.

```typescript
import { schema, ty } from "defynets";

const Config = schema()
    .field("db", ty.string)
    .field("cache", ty.string)
    .field("pool", $ => $.ref("db"))        // pool depends on db
    .field("session", $ => $.ref("cache"))   // session depends on cache
    .done();
```

Now watch what happens when you use it:

```typescript
Config.                          // autocomplete: defineDb, defineCache
                                 // pool and session are HIDDEN — deps not met

Config
    .defineDb("postgres://localhost/app")
    //                               ↓ definePool appears — db is now defined
    .definePool("postgres://localhost/app")
    .defineCache("redis://localhost")
    //                               ↓ defineSession appears — cache is now defined
    .defineSession("redis://localhost")
    .build();
```

`definePool` doesn't exist on the type until `defineDb` is called. Not hidden behind a flag. Not a runtime check. The **method literally doesn't exist** until its dependency is satisfied.

You declared a relationship between types. The builder enforced it. No generics.

---

## Step 3: The schema IS the architecture

Here's where the paradigm shift happens. Look at this:

```typescript
const API = schema()
    .field("endpoints", ty.dict(ty.object({
        request: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("response")),
    ))
    .done();
```

Read it out loud: *"There are endpoints, each with a request and response type. There are handlers — one per endpoint — each taking the endpoint's request and returning its response."*

That's not code. That's **architecture**. And now watch the builder in action:

```typescript
const api = API
    .defineEndpoints({
        getUser:   { request: ty.object({ id: ty.string }),   response: ty.object({ name: ty.string }) },
        listUsers: { request: ty.object({ page: ty.number }), response: ty.object({ users: ty.array(ty.string) }) },
    })
    .defineHandlers({
        getUser:   (req) => ({ name: `User ${req.id}` }),
        //          ^^^ req: { id: string } — inferred from getUser.request
        listUsers: (req) => ({ users: [`page${req.page}`] }),
        //          ^^^ req: { page: number } — inferred from listUsers.request
    })
    .build();
```

No generics. No mapped types. No `[K in keyof T]: (req: T[K]["request"]) => T[K]["response"]`. You declared the **relationship** — `handlers` depends on `endpoints`, each handler maps request → response — and TypeScript inferred everything.

**Compare with the traditional approach:**

```typescript
function createAPI<
    TEndpoints extends Record<string, { request: unknown; response: unknown }>,
    THandlers extends { [K in keyof TEndpoints]: (req: TEndpoints[K]["request"]) => TEndpoints[K]["response"] }
>(endpoints: TEndpoints, handlers: THandlers) { ... }
```

Two generic parameters for two fields. Add middleware? Three parameters. Add validators? Four. Every field adds a generic to every function that touches the system.

With `defynets`, adding middleware is one line:

```typescript
    .field("middleware", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("request")),     // transform request → request
    ))
```

No generics changed. No signatures rewritten. The schema grew, and the builder adapted.

---

## Step 4: Types first, implementations second

By now the pattern is clear:

1. **Declare types** — what things look like (`ty.object`, `ty.desc`, `ty.string`)
2. **Declare relationships** — how things connect (`$.from`, `$.ref`, `$$`)
3. **Implement** — the builder tells you what to fill in, in what order, with what types

This is **types-first development**. The schema is the single source of truth. Implementations follow.

Here's a task processing pipeline. Read the schema — it reads like a spec:

```typescript
const Pipeline = schema()
    // 1. Define task shapes
    .field("tasks", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    // 2. Workers handle specific tasks
    .field("workers", $ => $.dict($.object({
        handles: $.array($.from("tasks")),
        concurrency: $.type<number>(),
    })))
    // 3. Each task gets a typed handler
    .field("handlers", $ => $.dict($.from("tasks"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    // 4. Pipeline references tasks and workers by name
    .field("pipeline", $ => $.array($.object({
        task: $.from("tasks"),
        worker: $.from("workers"),
    })))
    .done();
```

Now implement it. The builder guides you:

```typescript
const system = Pipeline
    // Step 1: define tasks — no deps, available immediately
    .defineTaskTypes({
        resize: {
            input: ty.object({ url: ty.string, width: ty.number, height: ty.number }),
            output: ty.object({ url: ty.string, dimensions: ty.string }),
        },
        compress: {
            input: ty.object({ data: ty.string, level: ty.number }),
            output: ty.object({ data: ty.string, ratio: ty.number }),
        },
    })

    // Step 2: define workers — handles must be "resize" | "compress"
    .defineWorkers({
        gpuWorker: { handles: ["resize"], concurrency: 4 },
        cpuWorker: { handles: ["compress"], concurrency: 8 },
    })

    // Step 3: handlers — each typed per task
    .defineHandlers({
        resize:   (input) => ({ url: `done:${input.url}`, dimensions: `${input.width}x${input.height}` }),
        //         ^^^^^ { url: string, width: number, height: number }
        compress: (input) => ({ data: input.data.slice(0, input.level), ratio: 0.7 }),
        //         ^^^^^ { data: string, level: number }
    })

    // Step 4: pipeline — task and worker must reference existing keys
    .definePipeline([
        { task: "resize",   worker: "gpuWorker" },
        { task: "compress", worker: "cpuWorker" },
        // { task: "rotate", worker: "gpuWorker" }  ← TS error: "rotate" doesn't exist
    ])
    .build();
```

The schema is the **spec**. The builder is the **guided implementation**. TypeScript is the **verifier**.

---

## Deep dive: `from()` — where types connect

`$.from()` is the core mechanism. It says *"this field's keys come from that field."* Each source type works differently, and each solves a real problem.

### Keys from object — like `keyof`, but automatic

```typescript
const Flags = schema()
    .field("features", ty.object({ darkMode: ty.boolean, analytics: ty.boolean }))
    .field("descriptions", $ => $.dict($.from("features"), $.string))
    .done();

Flags
    .defineFeatures({ darkMode: true, analytics: false })
    .defineDescriptions({
        darkMode:  "Toggle dark color scheme",
        analytics: "Usage tracking",
        // typo: "..."  ← TS error
    })
    .build();
```

You didn't write `keyof`. You said *"descriptions has the same keys as features"*.

### Keys from array — elements become keys

```typescript
const Auth = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => $.dict($.from("roles"), $.type<boolean>()))
    .done();

Auth
    .defineRoles(["admin", "editor", "viewer"])
    .definePermissions({
        admin: true, editor: true, viewer: false,
        // hacker: true  ← TS error
    })
    .build();
```

Define `["admin", "editor", "viewer"]` — and permissions must have exactly those keys. No `R extends readonly string[]`, no `R[number]`.

### Keys from string — a single value becomes a key

```typescript
const Tenant = schema()
    .field("name", ty.string)
    .field("quota", $ => $.dict($.from("name"), $.number))
    .done();

Tenant
    .defineName("acme")
    .defineQuota({ acme: 42 })   // ← exactly one key: "acme"
    .build();
```

### Keys from deep path — reach into nested structures

```typescript
const Network = schema()
    .field("services", ty.dict(ty.object({
        config: ty.object({ label: ty.string, timeout: ty.number }),
    })))
    .field("timeouts", $ => $.dict($.from("services", "config", "label"), $.number))
    .done();

Network
    .defineServices({
        api:      { config: { label: "REST",      timeout: 5000 } },
        realtime: { config: { label: "WebSocket",  timeout: 30000 } },
    })
    .defineTimeouts({
        "REST":      5000,
        "WebSocket": 30000,
        // "GraphQL": 1000  ← TS error: not a label value
    })
    .build();
```

`$.from("services", "config", "label")` — three segments, each with **autocomplete**. No recursive conditional types.

### Per-key projection — each value typed by its key

The most powerful form. Instead of a uniform value type, each key gets its own type derived from the source entry:

```typescript
const System = schema()
    .field("tasks", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("tasks"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    .done();
```

`$$("input")` inside the callback means *"the input field of the current entry"*. For `resize`, that's `{ url: string, width: number }`. For `compress`, that's `{ data: string }`. Each handler gets **its own signature**.

**Instead of:**

```typescript
type Handlers<T extends Record<string, { input: unknown; output: unknown }>> = {
    [K in keyof T]: (input: T[K]["input"]) => T[K]["output"]
};
```

**Now:** `$$.fn($$("input"), $$("output"))`. The mapped type is expressed as a **relationship**, not as type gymnastics.

---

## Nested schemas — modular type-first systems

Schemas can embed other schemas. Types propagate through nesting levels.

```typescript
// A reusable core module (NOT .done() — stays composable)
const Core = schema()
    .field("events", ty.dict(ty.object({ payload: ty.desc, response: ty.desc })))
    .field("handlers", $ => $.dict($.from("events"), $$ =>
        $$.fn($$("payload"), $$("response")),
    ));

// An application that embeds the core + adds its own concerns
const App = schema()
    .field("core", Core)                                       // ← nested schema
    .field("loggers", $ => $.dict($.from("core", "events"),    // ← ref into nested
        $$ => $$.fn($$("payload"), $$.string),
    ))
    .done();
```

Building it:

```typescript
const app = App
    .defineCore(b => b                                          // ← inner SmartBuilder
        .defineEvents({
            order: {
                payload: ty.object({ userId: ty.string, total: ty.number }),
                response: ty.object({ orderId: ty.string }),
            },
        })
        .defineHandlers({                                       // ← appears after defineEvents
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

The inner `defineCore(b => ...)` is a full SmartBuilder — with its own dependency tracking, its own ordering. Internal dependencies (handlers → events) stay inside. They don't leak to the outer schema.

Nesting is recursive. A schema can embed a schema that embeds a schema.

---

## Error messages

`build()` is always visible. When fields are missing, it tells you what:

```typescript
builder.build
//      ^^^^^ BuildNotReady<"handlers" | "middleware">
//             _missing: "handlers" | "middleware"
```

Methods with unmet deps don't show in autocomplete — no noise, just what you can do right now.

---

## Inner builders

Every `defineX()` accepts a value or a callback:

```typescript
.defineConfig(b => b.defineHost("localhost").definePort(3000).build())     // ObjStepBuilder
.defineSteps(b => b.add({ name: "init" }).add({ name: "run" }).done())    // ArrStepBuilder
.defineTasks(b => b.entry("resize", {...}).entry("compress", {...}).done()) // DictStepBuilder
.defineCore(b => b.defineEvents({...}).defineHandlers({...}).build())       // SmartBuilder (nested)
```

---

## The `ty` DSL

| Helper | What it does |
|--------|-------------|
| `ty.string`, `ty.number`, `ty.boolean` | Primitives |
| `ty.type<T>()` | Explicit TypeScript type |
| `ty.desc` | Type descriptor — resolved at build time |
| `ty.ref("field")` | This field equals that field's value |
| `ty.from("field", ...path)` | Keys come from that field (with deep path) |
| `ty.object({ k: ty.* })` | Nested object shape |
| `ty.array(el)` | Readonly array |
| `ty.dict(...)` | Dict — free / constrained / per-key projected |
| `ty.fn(in, out)` | Function type |
| `ty.nullable(inner)` | `T \| null` |
| `ty.merge(a, b)` | `A & B` |
| `ty.oneOf(a, b)` | `A \| B` |

---

## API

| Function | What it does |
|----------|-------------|
| `schema()` | Start schema → `.field()` chain → `.done()` |
| `MakeBuilder<T>()` | Instant builder from any interface |
| `MakeDepBuilder<S>()` | Builder from raw HKT schema |
| `defineSchema(desc)` | Builder from flat descriptor |

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
| 1 | [01-hello-world.ts](examples/01-hello-world.ts) | Builders from interfaces and schemas |
| 2 | [02-dependencies.ts](examples/02-dependencies.ts) | Fields that depend on each other |
| 3 | [03-dict-patterns.ts](examples/03-dict-patterns.ts) | Five ways to derive dict keys |
| 4 | [04-projections.ts](examples/04-projections.ts) | Per-key projections with `$$()` |
| 5 | [05-full-pipeline.ts](examples/05-full-pipeline.ts) | Complete multi-level pipeline |
| 6 | [06-meta-framework.ts](examples/06-meta-framework.ts) | Nested schemas, modular composition |

---

MIT
