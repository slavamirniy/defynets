# defynets

**Types first. Dependencies second. Implementations last.**

```bash
npm i git+https://github.com/slavamirniy/defynets.git
```

---

## The idea

TypeScript is powerful. But in practice, you still write **code first** and then fight the type system to make it safe. Generics get out of hand. Builder classes are boilerplate. Config objects lose type connections between fields.

`defynets` flips this. You describe **what your system looks like** — types, shapes, and how they depend on each other. The library gives you a builder that **guides the implementor** through the correct construction, step by step, with full inference at every point.

You don't write builders. You don't write generics. You write a **schema** — and TypeScript becomes a declarative configuration system.

---

## Step 1: A builder appears

You have an interface. You want a builder for it.

**Without defynets:**

```typescript
class ServerBuilder {
    private host?: string;
    private port?: number;
    private debug?: boolean;

    setHost(v: string)   { this.host = v;  return this; }
    setPort(v: number)   { this.port = v;  return this; }
    setDebug(v: boolean) { this.debug = v; return this; }

    build() {
        if (!this.host)           throw new Error("host required");
        if (this.port === undefined) throw new Error("port required");
        if (this.debug === undefined) throw new Error("debug required");
        return { host: this.host, port: this.port, debug: this.debug };
    }
}

const server = new ServerBuilder().setHost("localhost").setPort(3000).setDebug(true).build();
```

15 lines. Runtime errors. No compile-time check for "is everything set?". Every new field = more boilerplate.

**With defynets:**

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

Remove `definePort()` — `build()` disappears from autocomplete. Pass a string to `definePort()` — compile error. No class, no runtime checks.

But this is just the surface. It gets interesting when fields start **talking to each other**.

---

## Step 2: Fields that know about each other

You have feature flags and you need a description for each flag. The keys must match.

**Without defynets:**

```typescript
interface Features {
    darkMode: boolean;
    analytics: boolean;
    i18n: boolean;
}

function createSystem<F extends Record<string, boolean>>(
    features: F,
    descriptions: { [K in keyof F]: string },
) {
    return { features, descriptions };
}

const system = createSystem(
    { darkMode: true, analytics: false, i18n: true },
    { darkMode: "Dark color scheme", analytics: "Usage tracking", i18n: "Multi-language" },
);
```

It works, but `features` and `descriptions` must be passed **at the same time** into a single function call. You can't define features first, do something else, and then add descriptions later. And adding a third field (like `enabledBy`) means rewriting the function signature with another generic parameter.

**With defynets:**

```typescript
import { schema, ty } from "defynets";

const System = schema()
    .field("features", ty.object({ darkMode: ty.boolean, analytics: ty.boolean, i18n: ty.boolean }))
    .field("descriptions", $ => $.dict($.from("features"), $.string))
    .done();
```

`$.from("features")` means *"descriptions has the same keys as features."* Now use it:

```typescript
const sys = System
    .defineFeatures({ darkMode: true, analytics: false, i18n: true })
    // ↓ defineDescriptions appears — features is defined, keys are known
    .defineDescriptions({
        darkMode:  "Dark color scheme",
        analytics: "Usage tracking",
        i18n:      "Multi-language",
        // typo:   "..."  ← TS error: "typo" is not a key of features
    })
    .build();
```

Step by step. Each field defined independently. Keys constrained automatically. Adding a third concern — one more `.field()`, zero changes to existing code.

---

## Step 3: Dynamic keys — types flow from values

Now the keys aren't known at schema time. The **user** defines them.

**Without defynets:**

```typescript
function createRBAC<R extends readonly string[]>(
    roles: R,
    permissions: { [K in R[number]]: boolean },
) {
    return { roles, permissions };
}

const rbac = createRBAC(
    ["admin", "editor", "viewer"] as const,  // ← need `as const`!
    { admin: true, editor: true, viewer: false },
);
```

`as const` required. Both args passed at once. Add a `labels` field per role → another generic parameter, another mapped type. And you still can't define roles first and permissions later.

**With defynets:**

```typescript
const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => $.dict($.from("roles"), $.type<boolean>()))
    .done();
```

```typescript
const rbac = RBAC
    .defineRoles(["admin", "editor", "viewer"])
    // ↓ permissions requires exactly "admin" | "editor" | "viewer" as keys
    .definePermissions({
        admin:  true,
        editor: true,
        viewer: false,
        // hacker: true  ← TS error
    })
    .build();
```

No `as const`. No generics. Roles defined first → permissions keys inferred from the actual values. Add labels per role? One more `.field()`:

```typescript
    .field("labels", $ => $.dict($.from("roles"), $.string))
```

No signature changes. No new generics. The schema grew, and the builder adapted.

---

## Step 4: The schema IS the architecture

Here's where the paradigm shift happens. You're not writing "a function that takes generics." You're **declaring the architecture** and letting TypeScript enforce it.

**Without defynets:**

```typescript
type EndpointDef = { request: unknown; response: unknown };

function createAPI<
    TEndpoints extends Record<string, EndpointDef>,
    THandlers extends {
        [K in keyof TEndpoints]: (req: TEndpoints[K]["request"]) => TEndpoints[K]["response"]
    },
    TMiddleware extends {
        [K in keyof TEndpoints]: (req: TEndpoints[K]["request"]) => TEndpoints[K]["request"]
    }
>(endpoints: TEndpoints, handlers: THandlers, middleware: TMiddleware) {
    return { endpoints, handlers, middleware };
}
```

Three generic parameters. Three mapped types. Everything passed at once — you can't split the definition. Adding a fourth concern (validation? logging?) means yet another generic parameter and mapped type in the signature.

**With defynets:**

```typescript
const API = schema()
    .field("endpoints", ty.dict(ty.object({
        request: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("response")),
    ))
    .field("middleware", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("request")),
    ))
    .done();
```

Read it out loud: *"There are endpoints with request/response types. Handlers map request → response per endpoint. Middleware transforms request → request per endpoint."*

That's **architecture**, not type gymnastics. Now use it:

```typescript
const api = API
    .defineEndpoints({
        getUser:   { request: ty.object({ id: ty.string }),   response: ty.object({ name: ty.string }) },
        listUsers: { request: ty.object({ page: ty.number }), response: ty.object({ users: ty.array(ty.string) }) },
    })
    // ↓ defineHandlers appears. Each handler typed per-endpoint:
    .defineHandlers({
        getUser:   (req) => ({ name: `User ${req.id}` }),
        //          ^^^ req: { id: string } — inferred from getUser.request
        listUsers: (req) => ({ users: [`page${req.page}`] }),
        //          ^^^ req: { page: number } — inferred from listUsers.request
    })
    // ↓ defineMiddleware appears. Input AND output = request type:
    .defineMiddleware({
        getUser:   (req) => ({ ...req, id: req.id.trim() }),
        listUsers: (req) => req,
    })
    .build();
```

Adding validation? One line in the schema:

```typescript
    .field("validators", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$.type<boolean>()),
    ))
```

No generics changed. No signatures rewritten. The builder shows `defineValidators` after `defineEndpoints` is called, with correct per-endpoint typing.

---

## Step 5: Types first, implementations second

By now the pattern is clear:

1. **Declare types** — what things look like (`ty.object`, `ty.desc`, `ty.string`)
2. **Declare relationships** — how things connect (`$.from`, `$$`)
3. **Implement** — the builder tells you what to fill in, in what order, with what types

This is **types-first development**. The schema is the single source of truth. Implementations follow.

Here's a task processing pipeline. The schema reads like a spec:

```typescript
const Pipeline = schema()
    .field("tasks", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("workers", $ => $.dict($.object({
        handles: $.array($.from("tasks")),
        concurrency: $.type<number>(),
    })))
    .field("handlers", $ => $.dict($.from("tasks"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    .field("pipeline", $ => $.array($.object({
        task: $.from("tasks"),
        worker: $.from("workers"),
    })))
    .done();
```

The builder guides the implementation:

```typescript
const system = Pipeline
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
    .defineWorkers({
        gpuWorker: { handles: ["resize"], concurrency: 4 },
        cpuWorker: { handles: ["compress"], concurrency: 8 },
        // handles must be ("resize" | "compress")[]
    })
    .defineHandlers({
        resize:   (input) => ({ url: `done:${input.url}`, dimensions: `${input.width}x${input.height}` }),
        //         ^^^^^ { url: string, width: number, height: number }
        compress: (input) => ({ data: input.data.slice(0, input.level), ratio: 0.7 }),
        //         ^^^^^ { data: string, level: number }
    })
    .definePipeline([
        { task: "resize",   worker: "gpuWorker" },
        { task: "compress", worker: "cpuWorker" },
        // { task: "rotate", worker: "gpuWorker" }  ← TS error: "rotate" doesn't exist
    ])
    .build();
```

Schema = **spec**. Builder = **guided implementation**. TypeScript = **verifier**.

---

## Deep dive: `from()` patterns

`$.from()` is the core mechanism — *"this field's structure comes from that field."* It works differently depending on the source type.

### Keys from a single string

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

### Keys from deep path

Reach into nested structures to extract keys:

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

`$.from("services", "config", "label")` — each segment has **autocomplete**. No recursive conditional types.

### Per-key projection with `$$`

The most powerful form. Instead of a uniform value type, each key gets its own type derived from the source entry.

**Without defynets:**

```typescript
type Handlers<T extends Record<string, { input: unknown; output: unknown }>> = {
    [K in keyof T]: (input: T[K]["input"]) => T[K]["output"]
};
```

**With defynets:**

```typescript
.field("handlers", $ => $.dict($.from("tasks"), $$ =>
    $$.fn($$("input"), $$("output")),
))
```

`$$("input")` means *"the input field of the current entry."* For `resize`, that's `{ url: string, width: number }`. For `compress`, that's `{ data: string }`. Each handler gets **its own signature**. The mapped type is expressed as a **relationship**, not as type-level code.

---

## Nested schemas — modular type-first systems

Schemas can embed other schemas as fields. Types propagate through nesting levels.

**Without defynets:**

```typescript
// Module A
function createCore<T extends Record<string, EventDef>>(events: T) { ... }

// Module B — must import A's generics, wire them manually
function createApp<T extends Record<string, EventDef>>(
    core: ReturnType<typeof createCore<T>>,
    loggers: { [K in keyof T]: (payload: T[K]["payload"]) => string },
) { ... }
// Every module adds generics. Doesn't scale.
```

**With defynets:**

```typescript
const Core = schema()
    .field("events", ty.dict(ty.object({ payload: ty.desc, response: ty.desc })))
    .field("handlers", $ => $.dict($.from("events"), $$ =>
        $$.fn($$("payload"), $$("response")),
    ));

const App = schema()
    .field("core", Core)                                       // ← nested schema
    .field("loggers", $ => $.dict($.from("core", "events"),    // ← ref into nested
        $$ => $$.fn($$("payload"), $$.string),
    ))
    .done();
```

Building it — `defineCore` opens an **inner SmartBuilder** with its own dependency tracking:

```typescript
const app = App
    .defineCore(b => b
        .defineEvents({
            order: {
                payload: ty.object({ userId: ty.string, total: ty.number }),
                response: ty.object({ orderId: ty.string }),
            },
        })
        .defineHandlers({                                      // ← appears after defineEvents
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

Internal deps (handlers → events) stay **inside** the nested builder. They don't leak. Nesting is recursive — schemas can embed schemas that embed schemas.

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

## Inner builders

Every `defineX()` accepts a value or a callback:

```typescript
.defineConfig(b => b.defineHost("localhost").definePort(3000).build())      // ObjStepBuilder
.defineSteps(b => b.add({ name: "init" }).add({ name: "run" }).done())     // ArrStepBuilder
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
| `ty.from("field", ...path)` | Keys come from that field (with deep path) |
| `ty.object({ k: ty.* })` | Nested object shape |
| `ty.array(el)` | Readonly array |
| `ty.dict(...)` | Dict — free / constrained / per-key projected |
| `ty.fn(in, out)` | Function type |
| `ty.nullable(inner)` | `T \| null` |
| `ty.merge(a, b)` | `A & B` |
| `ty.oneOf(a, b)` | `A \| B` |
| `ty.ref("field")` | Copy another field's type |

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
