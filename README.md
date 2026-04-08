# defynets

**Declarative schemas that build themselves. TypeScript does the rest.**

```bash
npm i git+https://github.com/slavamirniy/defynets.git
```

---

## What is this?

You describe the **shape** of your config. `defynets` gives you a **builder** that:

- Only shows methods you're allowed to call right now
- Infers every type at every step — zero `as any`, full autocomplete
- Tells you exactly what's missing if you try to `build()` too early
- Supports nesting, cross-references, per-key projections, modular composition

It's a **type-level dependency graph** that guides the developer through the correct construction order.

---

## The "Aha" Moment

### Before: manual builder, 200 lines of boilerplate

```typescript
class PipelineBuilder {
    private tasks?: Record<string, TaskDef>;
    private handlers?: Record<string, Function>;

    defineTasks(t: Record<string, TaskDef>) { this.tasks = t; return this; }
    defineHandlers(h: Record<string, Function>) { this.handlers = h; return this; }

    build() {
        if (!this.tasks) throw new Error("tasks required");
        if (!this.handlers) throw new Error("handlers required");
        // no type link between tasks and handlers
        // handler args are `any`
        // nothing prevents calling defineHandlers before defineTasks
        return { tasks: this.tasks, handlers: this.handlers };
    }
}
```

Problems: no connection between task types and handler signatures, no ordering, runtime errors, `any` everywhere.

### After: 12 lines of schema, everything inferred

```typescript
import { schema, ty } from "defynets";

const Pipeline = schema()
    .field("tasks", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("tasks"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    .done();
```

Now:
- `defineHandlers` only appears **after** `defineTasks`
- Each handler is typed `(input: ConcreteInput) => ConcreteOutput` per task
- Keys are constrained — you can't add a handler for a task that doesn't exist
- `build()` shows `BuildNotReady<"handlers">` until everything is defined

---

## Key Features

### 1. Reactive Method Visibility

Methods appear and disappear based on what you've already defined.

```typescript
const App = schema()
    .field("db", ty.string)
    .field("cache", ty.string)
    .field("pool", $ => $.ref("db"))      // depends on db
    .field("session", $ => $.ref("cache")) // depends on cache
    .done();

App.                      // autocomplete: defineDb, defineCache
App.defineDb("postgres"). // autocomplete: defineCache, definePool ← pool unlocked
```

This isn't a runtime check. It's a **compile-time guarantee** — the method literally doesn't exist on the type until its dependencies are satisfied.

**Comparison with Zod / io-ts / Effect Schema:**
Those validate **data at runtime**. `defynets` validates **construction order at compile time**. They solve different problems — use both together if needed.

### 2. Cross-Field Type Propagation

Define a field once. Reference it everywhere. Types flow automatically.

```typescript
const API = schema()
    .field("endpoints", ty.dict(ty.object({
        request: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("response"))
    ))
    .field("mocks", $ => $.dict($.from("endpoints"), $$ =>
        $$.fn($$("request"), $$("response"))
    ))
    .done();
```

Define endpoints once → handlers AND mocks are both typed per-endpoint. Change an endpoint's request type → both handler and mock signatures update. Zero duplication.

### 3. Five Dict Key Sources

Dictionaries can derive their keys from anything:

```typescript
schema()
    // Free keys — any string
    .field("env", ty.dict(ty.string))

    // From object keys — keyof
    .field("features", ty.object({ dark: ty.boolean, i18n: ty.boolean }))
    .field("labels", $ => $.dict($.from("features"), $.string))
    // → { dark: string, i18n: string }

    // From string array elements
    .field("roles", ty.array(ty.string))
    .field("perms", $ => $.dict($.from("roles"), $.boolean))
    // defineRoles(["admin","viewer"]) → { admin: bool, viewer: bool }

    // From a single string value
    .field("tenant", ty.string)
    .field("quota", $ => $.dict($.from("tenant"), $.number))
    // defineTenant("acme") → { acme: number }

    // From deep path values
    .field("channels", ty.dict(ty.object({
        config: ty.object({ label: ty.string }),
    })))
    .field("timeouts", $ => $.dict($.from("channels", "config", "label"), $.number))
    // label values become keys
```

Every `$.from()` path segment has **autocomplete** — you can't mistype a path.

### 4. Per-Key Projection with `$$`

Inside `dict(source, $$ => ...)`, the `$$` callable gives you access to each entry's fields:

```typescript
.field("tasks", ty.dict(ty.object({
    input: ty.desc,
    output: ty.desc,
})))
.field("handlers", $ => $.dict($.from("tasks"), $$ =>
    $$.fn($$("input"), $$("output"))
    //    ^^^^^^^^^^^ typed per-task
))
```

`$$("input")` auto-unwraps `ty.desc` → resolved concrete type. Each handler gets **its own** input/output signature.

Callable syntax (`$$("field")`) avoids clashing with `$$.fn()`, `$$.object()`, etc.

### 5. Nested Schemas — Modular Config Architecture

This is the killer feature. Embed one schema inside another as a field. Types propagate through nesting levels:

```typescript
// Module: reusable core (NOT .done() — it's a SchemaDef)
const Core = schema()
    .field("events", ty.dict(ty.object({
        payload: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("events"), $$ =>
        $$.fn($$("payload"), $$("response")),
    ));

// Application: embeds Core as a field, adds cross-cutting concerns
const App = schema()
    .field("core", Core)                              // ← nested schema
    .field("loggers", $ => $.dict(
        $.from("core", "events"),                     // ← deep ref into nested
        $$ => $$.fn($$("payload"), $$.string),        // ← typed per-event
    ))
    .done();
```

At build time, `defineCore(b => ...)` opens an **inner SmartBuilder** with its own dependency tracking:

```typescript
App
    .defineCore(b => b
        .defineEvents({
            order: {
                payload: ty.object({ userId: ty.string, total: ty.number }),
                response: ty.object({ orderId: ty.string }),
            },
        })
        .defineHandlers({
            order: (ev) => ({ orderId: `ORD-${ev.userId}` }),
            //      ^^ ev: { userId: string, total: number } — inferred
        })
        .build()
    )
    .defineLoggers({
        order: (ev) => `Order from ${ev.userId}: $${ev.total}`,
        //      ^^ same ev type — propagated from core.events
    })
    .build();
```

**What makes this special:**
- Internal deps (handlers → events) stay **inside** the nested builder — they don't leak
- `$.from("core", "events")` reaches through the nesting with autocomplete at every level
- Nesting is **recursive** — embed schemas that embed schemas
- Each level has its own SmartBuilder with independent dep tracking

**Comparison with NestJS modules / Angular DI:**
Those wire up runtime services. `defynets` wires up **type relationships** at compile time — the schema IS the documentation, the validation, and the type system in one.

### 6. Informative Errors

`build()` is always visible. When fields are missing, it shows exactly what:

```typescript
const builder = App.defineDb("postgres");
builder.build
//      ^^^^^ BuildNotReady<"cache" | "session">
//             _missing: "cache" | "session"
```

Hidden `defineX()` methods don't clutter autocomplete. When `definePool` requires `db`, and `db` isn't defined yet — `definePool` simply doesn't exist on the type.

### 7. Inner Builders for Complex Values

Every `defineX()` accepts a plain value or a callback with a specialized builder:

```typescript
// Object builder → .defineField(v).build()
.defineConfig(b => b
    .defineHost("localhost")
    .definePort(3000)
    .build()
)

// Array builder → .add(v).done()
.definePipeline(b => b
    .add({ task: "resize", worker: "gpu" })
    .add({ task: "thumbnail", worker: "cpu" })
    .done()
)

// Dict builder → .entry(key, value).done()
.defineTasks(b => b
    .entry("resize", { input: ty.object({...}), output: ty.object({...}) })
    .entry("thumbnail", { input: ty.object({...}), output: ty.object({...}) })
    .done()
)
```

| HKT | Builder | API |
|-----|---------|-----|
| `Obj<Shape>` | `ObjStepBuilder` | `.defineX(v).build()` |
| `Arr<E>` | `ArrStepBuilder` | `.add(v).done()` |
| `DynRecord<V>` | `DictStepBuilder` | `.entry(k, v).done()` |
| `Schema<S>` | `SmartBuilder` | `.defineX(v).build()` (with dep tracking) |

---

## Full Example: Image Processing Pipeline

```typescript
import { schema, ty } from "defynets";

const Pipeline = schema()
    .field("taskTypes", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("workers", $ => $.dict($.object({
        handles: $.array($.from("taskTypes")),
        concurrency: $.type<number>(),
    })))
    .field("handlers", $ => $.dict($.from("taskTypes"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    .field("pipeline", $ => $.array($.object({
        task: $.from("taskTypes"),
        worker: $.from("workers"),
    })))
    .done();

const system = Pipeline
    .defineTaskTypes({
        resize: {
            input: ty.object({ url: ty.string, width: ty.number, height: ty.number }),
            output: ty.object({ url: ty.string, dimensions: ty.string }),
        },
        thumbnail: {
            input: ty.object({ url: ty.string }),
            output: ty.object({ thumbUrl: ty.string, size: ty.number }),
        },
    })
    .defineWorkers({
        imageWorker: { handles: ["resize", "thumbnail"], concurrency: 4 },
    })
    .defineHandlers({
        resize: (input) => ({
            url: `resized:${input.url}`,                    // ← input: { url, width, height }
            dimensions: `${input.width}x${input.height}`,
        }),
        thumbnail: (input) => ({
            thumbUrl: `thumb:${input.url}`,                  // ← input: { url }
            size: 128,
        }),
    })
    .definePipeline([
        { task: "resize", worker: "imageWorker" },
        { task: "thumbnail", worker: "imageWorker" },
        // { task: "compress", worker: "imageWorker" }  ← TS error: "compress" doesn't exist
    ])
    .build();
```

TypeScript enforces:
- `handles` must be `("resize" | "thumbnail")[]`
- Each handler gets **its own** typed signature (resize input !== thumbnail input)
- `task` / `worker` in pipeline must reference defined keys
- `build()` is uncallable until all 4 fields are defined

---

## The `ty` DSL

| Helper | Description | Example |
|--------|-------------|---------|
| `ty.string` | String primitive | `.field("name", ty.string)` |
| `ty.number` | Number primitive | `.field("port", ty.number)` |
| `ty.boolean` | Boolean primitive | `.field("debug", ty.boolean)` |
| `ty.type<T>()` | Explicit TS type | `.field("mode", ty.type<"dev" \| "prod">())` |
| `ty.desc` | Type descriptor (resolved at build time) | `.field("input", ty.desc)` |
| `ty.object({...})` | Nested object shape | `.field("db", ty.object({ url: ty.string }))` |
| `ty.array(el)` | Readonly array | `.field("tags", ty.array(ty.string))` |
| `ty.dict(...)` | Dict (free / constrained / projected) | See dict patterns above |
| `ty.nullable(inner)` | `T \| null` | `.field("bio", ty.nullable(ty.string))` |
| `ty.merge(a, b)` | Intersection `A & B` | `.field("full", ty.merge(ty.ref("a"), ty.ref("b")))` |
| `ty.oneOf(a, b)` | Union `A \| B` | `.field("result", ty.oneOf(ty.string, ty.number))` |
| `ty.fn(in, out)` | Function type | `.field("transform", ty.fn(ty.string, ty.number))` |
| `ty.ref("key")` | Reference another field | `.field("copy", ty.ref("name"))` |
| `ty.from("key", ...path)` | Key source for dicts | `$.dict($.from("tasks"), ...)` |

### Scoped Context `$` and `$$`

Inside `schema().field("x", $ => ...)`, the `$` object only exposes **previously defined** field names. You literally cannot reference a field that hasn't been declared yet.

Inside `$.dict($.from("x"), $$ => ...)`, the `$$` callable exposes **fields of the current entry**. The type changes per-key.

---

## API

| Function | What it does |
|----------|-------------|
| `schema()` | Start a schema → chain `.field()` → `.done()` |
| `MakeBuilder<T>()` | Instant builder from any interface (no deps) |
| `MakeDepBuilder<S>()` | Builder from raw HKT schema |
| `defineSchema(desc)` | Builder from flat descriptor object |

| Schema method | What it does |
|---------------|-------------|
| `.field(name, ty.*)` | Add a typed field |
| `.field(name, $ => ...)` | Add a field with cross-references |
| `.field(name, SchemaDef)` | Embed another schema as a nested field |
| `.done()` | Finalize → `SmartBuilder` |

---

## Examples

Progressive, from simple to complex — see [`examples/`](./examples):

| # | File | What it shows |
|---|------|---------------|
| 1 | [01-hello-world.ts](examples/01-hello-world.ts) | `MakeBuilder`, schema with `ty` DSL |
| 2 | [02-dependencies.ts](examples/02-dependencies.ts) | Cross-field deps, `ref`, `from`, `merge` |
| 3 | [03-dict-patterns.ts](examples/03-dict-patterns.ts) | All five dict key source patterns |
| 4 | [04-projections.ts](examples/04-projections.ts) | Per-key projections, `$$()`, inner builders |
| 5 | [05-full-pipeline.ts](examples/05-full-pipeline.ts) | Complete multi-level system |
| 6 | [06-meta-framework.ts](examples/06-meta-framework.ts) | Nested schemas, modular composition, 2-level nesting |

---

## When to Use This

**Good fit:**
- Config-first architectures (pipelines, frameworks, plugin systems)
- Schemas where fields depend on each other's types
- Builder APIs where construction order matters
- Modular systems that need type-safe composition across modules

**Not a fit:**
- Runtime data validation (use Zod / io-ts)
- ORM / database schemas (use Prisma / Drizzle)
- Simple configs with no cross-references (just use an interface)

---

## License

MIT
