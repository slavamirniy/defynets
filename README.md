# defynets

**A declarative DSL that replaces TypeScript generic gymnastics with readable schema definitions.**

Instead of `[K in keyof T]: T[K] extends ...` — write `ty.map`, `$.ref`, `ty.access`.
Same type safety. Zero generic parameters. Reads like a spec.

**[▶ Try it in the Playground](https://stackblitz.com/edit/defynets?file=playground.ts)**

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
    .field("handlers", $ => ty.map($.ref("endpoints"), e =>
        ty.fn(e.request, e.response),
    ))
    .field("middleware", $ => ty.map($.ref("endpoints"), e =>
        ty.fn(e.request, e.request),
    ))
    .done();
```

Read it: *"Endpoints have request/response descriptors. Handlers map each endpoint to request → response. Middleware maps each endpoint to request → request."*

That's **architecture as code**. The builder enforces dependency order, provides per-field autocomplete, and catches every mismatch at compile time. Adding validation? One more `.field()` — zero existing code changed.

---

## `$` is only for references

Inside a field callback `$ => ...`, the `$` object has exactly three methods:

| Method | What it does |
|--------|-------------|
| `$.ref("field")` | Reference another field. Supports deep path chaining: `$.ref("core").events` |
| `$.eval("field")` | Evaluate a `ty.desc` slot — resolves the stored `TypeTag` to a concrete type |
| `$.self()` | Schema-level self-reference (entire schema output) |

Everything else — `map`, `keysOf`, `record`, `access`, `merge`, `fn`, `array`, etc. — lives on `ty`. The `$` just connects fields to each other; `ty` describes shapes.

```typescript
.field("handlers", $ => ty.map($.ref("endpoints"), e =>
    ty.fn(e.request, e.response),
))
//                  ^^ ty does the mapping
//         ^^^^^^^^^ $ just points to "endpoints"
```

---

## The builder computes the dependency tree

Every `$.ref()` declares a dependency. The builder analyzes the graph and **progressively reveals** `defineX()` methods — you only see what you can define right now.

```typescript
const App = schema()
    //        field             depends on
    .field("roles",       ty.array(ty.string))                                          // —
    .field("theme",       ty.string)                                                    // —
    .field("permissions", $ => ty.record(ty.keysOf($.ref("roles")), ty.type<boolean>()))    // roles
    .field("welcome",     $ => $.ref("theme"))                                          // theme
    .field("summary",     $ => ty.fn($.ref("permissions"), ty.string))                    // permissions
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
    .field("logic", $ => ty.map($.ref("states"), state => ty.object({
        send: ty.fn(ty.keysOf(state.on), ty.type<void>()),
        render: ty.fn(state.data, ty.string),
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
    .field("steps", $ => ty.array(ty.object({
        from: ty.keysOf($.ref("registry")),
        to:   ty.keysOf($.ref("registry")),
    })))
    .field("handlers", $ => ty.map($.ref("steps"), step =>
        ty.fn(
            ty.access($.ref("registry"), step.from),
            ty.access($.ref("registry"), step.to),
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
    .field("fields", $ => ty.record(ty.keysOf($.ref("typeMap"))))
    .field("values", $ => ty.map($.ref("fields"), field =>
        ty.access($.ref("typeMap"), field),
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

### Step 2: Fields that reference each other — `$.ref`

Fields can depend on other fields. The builder only shows `defineX()` when X's dependencies are satisfied. `$` provides `$.ref("field")` to create these connections; all type operations stay on `ty`.

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
    .field("descriptions", $ => ty.record(ty.keysOf($.ref("features")), ty.string))
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

`$.ref("features")` creates a dependency. `ty.keysOf(...)` extracts the keys. `ty.record(keys, valueType)` builds a constrained dictionary.

**Keys from arrays — no `as const` needed:**

```typescript
const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => ty.record(ty.keysOf($.ref("roles")), ty.type<boolean>()))
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
    .field("quota", $ => ty.record(ty.keysOf($.ref("name")), ty.number))
    .done();

Tenant
    .defineName("acme")
    .defineQuota({ acme: 42 })   // ← exactly one key: "acme"
    .build();
```

---

### Step 3: Per-key projection — `ty.map`

The most powerful feature. Instead of a uniform value type, **each key gets its own type** derived from the source entry.

**Without defynets:**

```typescript
type Handlers<T extends Record<string, { input: unknown; output: unknown }>> = {
    [K in keyof T]: (input: T[K]["input"]) => T[K]["output"]
};
```

**With defynets:**

```typescript
.field("handlers", $ => ty.map($.ref("endpoints"), e =>
    ty.fn(e.request, e.response),
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
    .field("handlers", $ => ty.map($.ref("endpoints"), e =>
        ty.fn(e.request, e.response),
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
    .field("processors", $ => ty.map($.ref("tasks").name, e =>
        ty.fn(e.input, e.output),
    ))
    .done();
```

`$.ref("tasks").name` — keys come from the `name` field of each array element. The entry callback gives access to each element's other fields.

---

### Step 4: Type catalog — `ty.access`

Define types once, reference everywhere. `ty.access` resolves a type from a registry by key — a **type-level join**.

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
    .field("methods", $ => ty.record(ty.object({
        input:  ty.keysOf($.ref("types")),
        output: ty.keysOf($.ref("types")),
    })))
    .field("handlers", $ => ty.map($.ref("methods"), method =>
        ty.fn(
            ty.access($.ref("types"), method.input),
            ty.access($.ref("types"), method.output),
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

`method.input` is `"user"`. `ty.access($.ref("types"), method.input)` resolves to the actual `{ id: number, name: string }` type.

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
    .field("handlers", $ => ty.map($.ref("events"), event =>
        ty.fn(event.payload, event.response),
    ));

const App = schema()
    .field("core", Core)
    .field("loggers", $ => ty.map($.ref("core").events, event =>
        ty.fn(event.payload, ty.string),
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
    .field("children", $ => ty.array($.self()))
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

### Step 7: Type slots — `$.eval`

Define a **type descriptor slot** with `ty.desc`. Resolve its concrete type elsewhere with `$.eval("field")`. The builder user provides a type — every dependent field resolves automatically. This is the **framework author pattern**: define the shape of a system once, let consumers plug in their types.

**Without defynets:**

```typescript
function createServer<Ctx>(opts: {
    createContext: (req: Request) => Ctx,
    routes: Record<string, (ctx: Ctx) => Promise<any>>,
}) { ... }
// One generic, but it grows fast when you add middleware, hooks, etc.
```

**With defynets:**

```typescript
const ServerCore = schema()
    .field("ContextType", ty.desc)
    .field("createContext", $ => ty.fn(ty.type<Request>(), $.eval("ContextType")))
    .field("routes", $ => ty.record(
        ty.fn($.eval("ContextType"), ty.promise(ty.type<any>())),
    ))
    .done();
```

Read it: *"ContextType is a type slot. createContext produces it from a Request. Routes are functions that receive it."*

The builder user fills the slot — everything resolves:

```typescript
const server = ServerCore
    .defineContextType(ty.object({
        db: ty.type<DB>(),
        userId: ty.string,
    }))
    // createContext now expects: (req: Request) => { db: DB, userId: string }
    .defineCreateContext((req) => ({
        db: getDB(),
        userId: req.headers["x-user-id"] ?? "",
    }))
    // Each route handler gets ctx: { db: DB, userId: string }
    .defineRoutes({
        getUser: async (ctx) => ctx.db.user.findFirst({ where: { id: ctx.userId } }),
    })
    .build();
```

**State manager — same pattern:**

```typescript
const StoreBuilder = schema()
    .field("StateType", ty.desc)
    .field("initialState", $ => $.eval("StateType"))
    .field("mutations", $ => ty.record(
        ty.fn($.eval("StateType"), ty.type<Record<string, any>>()),
    ))
    .done();

const store = StoreBuilder
    .defineStateType(ty.object({ count: ty.number, user: ty.nullable(ty.string) }))
    .defineInitialState({ count: 0, user: null })
    .defineMutations({
        increment: (state) => ({ count: state.count + 1 }),
        login:     (state) => ({ user: "Alice" }),
    })
    .build();
```

**ORM — eval + map + merge:**

```typescript
const ORMBuilder = schema()
    .field("BaseModel", ty.desc)
    .field("tableSchemas", ty.record(ty.desc))
    .field("tables", $ => ty.map($.ref("tableSchemas"), $$ =>
        ty.merge($.eval("BaseModel"), $$),
    ))
    .done();

const db = ORMBuilder
    .defineBaseModel(ty.object({ id: ty.string, createdAt: ty.type<Date>() }))
    .defineTableSchemas({
        users: ty.object({ email: ty.string, age: ty.number }),
        posts: ty.object({ title: ty.string, content: ty.string }),
    })
    // Each table = BaseModel & specific fields
    .defineTables({
        users: { id: "1", createdAt: new Date(), email: "a@b.com", age: 25 },
        posts: { id: "2", createdAt: new Date(), title: "Hi", content: "..." },
    })
    .build();
```

`$.eval("BaseModel")` resolves the type descriptor to `{ id: string, createdAt: Date }`. `ty.merge` intersects it with each table's own fields. The builder enforces both base and specific fields per table.

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
| `ty.record(keys, valueType)` | Constrained-key dictionary |
| `ty.fn(in, out)` | Function type |
| `ty.map(source, e => ...)` | Per-key projection over dict/array |
| `ty.keysOf(tag)` | Extract keys: string → itself, array → elements, object → `keyof` |
| `ty.valuesOf(tag)` | Extract values from a type |
| `ty.access(tag, key)` | Type-level field access by key. Unwraps `TypeTag` automatically |
| `ty.nullable(inner)` | `T \| null` |
| `ty.merge(a, b)` | `A & B` |
| `ty.oneOf(a, b)` | `A \| B` |
| `ty.promise(inner)` | `Promise<T>` |
| `ty.self()` | Recursive self-reference (inside `ty.object`) |
| `ty.eval(key)` | Evaluate a `ty.desc` slot — resolves stored `TypeTag` to concrete type |

## The `$` ref scope (inside field callbacks)

`$` is available inside `schema().field("name", $ => ...)`. Its sole purpose is to create references between fields — all type operations stay on `ty`.

| Method | What it does |
|--------|-------------|
| `$.ref("field")` | Reference another field. Supports deep path chaining: `$.ref("core").events` |
| `$.eval("field")` | Evaluate a `ty.desc` slot — resolves the stored `TypeTag` to a concrete type |
| `$.self()` | Schema-level self-reference (entire schema output) |

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
| 2 | [02-dependencies.ts](examples/02-dependencies.ts) | `$.ref`, `ty.keysOf`, `ty.record`, `ty.merge`, `ty.map` |
| 3 | [03-dict-patterns.ts](examples/03-dict-patterns.ts) | Five ways to derive dict keys |
| 4 | [04-projections.ts](examples/04-projections.ts) | Per-key projections with `ty.map`, inner builders |
| 5 | [05-full-pipeline.ts](examples/05-full-pipeline.ts) | Complete multi-level system |
| 6 | [06-meta-framework.ts](examples/06-meta-framework.ts) | Nested schemas, modular composition |
| 7 | [07-type-catalog.ts](examples/07-type-catalog.ts) | Type catalog with `ty.access` |
| 8 | [08-fsm-pipeline-worker.ts](examples/08-fsm-pipeline-worker.ts) | FSM, pipeline, worker queue |
| 9 | [09-recursion-and-advanced.ts](examples/09-recursion-and-advanced.ts) | `$.self()`, `ty.self()`, graphs, dynamic form builder |
| 10 | [10-playground.ts](examples/10-playground.ts) | RPC + recursive workflows + component system — all features combined |
| 11 | [11-eval-server-framework.ts](examples/11-eval-server-framework.ts) | `$.eval` — type slots for server context |
| 12 | [12-eval-state-manager.ts](examples/12-eval-state-manager.ts) | `$.eval` — state management kernel |
| 13 | [13-eval-orm-builder.ts](examples/13-eval-orm-builder.ts) | `$.eval` + `ty.merge` — ORM / CMS builder |

---

MIT
