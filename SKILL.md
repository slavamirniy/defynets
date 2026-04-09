# defynets — AI Skill Guide

## What is defynets

`defynets` is a TypeScript DSL that replaces complex generic types with declarative, composable schema definitions. You write `$.map`, `$.ref`, `$.access` instead of `[K in keyof T]: T[K] extends ...`. The library generates type-safe builders with dependency-aware method chaining.

## When to use

- User wants to define type-safe builders or configurations with inter-field dependencies
- User needs mapped types, constrained record keys, conditional type lookups — expressible declaratively
- User wants to create FSM, pipeline, worker queue, form builder, or similar typed systems
- User wants to replace unreadable TypeScript generics with a readable DSL

## Installation

```bash
npm i git+https://github.com/slavamirniy/defynets.git
```

## Core Imports

```typescript
import { schema, ty } from "defynets";
```

- `schema()` — start building a schema definition
- `ty` — type DSL for field types (used outside callbacks and inside `ty.object`)
- `$` — scoped type DSL with cross-references (auto-provided in `.field("name", $ => ...)` callbacks)

---

## Schema Definition Pattern

```typescript
const MySchema = schema()
    .field("fieldA", ty.string)                        // static type
    .field("fieldB", $ => $.ref("fieldA"))             // references fieldA
    .field("fieldC", $ => $.map($.ref("fieldA"), ...)) // maps over fieldA
    .field("fieldD", NestedSchemaDef)                  // nested schema (no .done())
    .done();                                            // → SmartBuilder
```

## Builder Usage Pattern

```typescript
const result = MySchema
    .defineFieldA("value")
    .defineFieldB(...)
    .build();
```

- `defineX()` appears only when field X's dependencies are satisfied
- `build()` available when all fields are defined
- Hover over `build` to see `BuildNotReady<"missing">` with missing field names

## Inner Builder Pattern (callback syntax)

```typescript
.defineField(b => b.defineX(v).build())          // object fields
.defineField(b => b.add(v).add(v).done())        // array fields
.defineField(b => b.entry("k", v).done())        // dict fields
.defineField(b => b.defineX(v).build())           // nested schema
.defineField((b, ctx) => ...)                     // ctx = already defined fields
```

---

## ty.* API (outside callbacks)

| Method | Type | Example |
|--------|------|---------|
| `ty.string` | `string` | `.field("name", ty.string)` |
| `ty.number` | `number` | `.field("port", ty.number)` |
| `ty.boolean` | `boolean` | `.field("debug", ty.boolean)` |
| `ty.desc` | type descriptor | `.field("input", ty.desc)` — consumer passes `ty.object(...)` or `ty.type<T>()` at build time |
| `ty.type<T>()` | explicit `T` | `ty.type<"admin" \| "user">()` |
| `ty.self()` | object self-ref | Inside `ty.object({...})` — recursive reference to the object being defined |
| `ty.object(shape)` | `{ ... }` | `ty.object({ host: ty.string, port: ty.number })` |
| `ty.array(el)` | `readonly T[]` | `ty.array(ty.string)` |
| `ty.record(val)` | `Record<string, V>` | `ty.record(ty.string)` — free-key dict |
| `ty.fn(in, out)` | `(in) => out` | `ty.fn(ty.type<Request>(), ty.type<Response>())` |
| `ty.nullable(inner)` | `T \| null` | `ty.nullable(ty.string)` |
| `ty.merge(a, b)` | `A & B` | `ty.merge(ty.type<{x: 1}>(), ty.type<{y: 2}>())` |
| `ty.oneOf(a, b)` | `A \| B` | `ty.oneOf(ty.string, ty.number)` |
| `ty.promise(inner)` | `Promise<T>` | `ty.promise(ty.string)` |

## $.* API (inside field callbacks)

Inside `.field("name", $ => ...)`:

**All `ty.*` methods available** (`$.string`, `$.number`, `$.boolean`, `$.desc`, `$.type<T>()`, `$.object(...)`, `$.array(...)`, `$.fn(...)`, `$.nullable(...)`, `$.merge(...)`, `$.oneOf(...)`, `$.promise(...)`), plus:

| Method | Purpose | Example |
|--------|---------|---------|
| `$.ref("field")` | Reference a previously defined field. Returns RefTag supporting deep chaining | `$.ref("core").events.payload` |
| `$.self()` | Schema-level self-reference (full schema output) | `$.array($.self())` — recursive schema |
| `$.map(source, e => expr)` | Per-key projection. Source is RefTag. Entry `e` exposes fields of each dict/array element | `$.map($.ref("tasks"), e => $.fn(e.input, e.output))` |
| `$.keysOf(tag)` | Extract keys from type: string → itself, array → elements, object → `keyof` | `$.keysOf($.ref("roles"))` |
| `$.valuesOf(tag)` | Extract values from type | `$.valuesOf($.ref("config"))` |
| `$.access(tag, keyTag)` | Type-level lookup: `tag[key]`. Auto-unwraps TypeTag to concrete type | `$.access($.ref("types"), method.input)` |
| `$.record(val)` | Free-key dictionary | `$.record($.string)` |
| `$.record(keys, val)` | Constrained-key dictionary | `$.record($.keysOf($.ref("roles")), $.string)` |

### Deep path via RefTag chaining

`$.ref("field")` returns a RefTag that supports property access for deep paths:

```typescript
$.ref("core").events          // → events field of nested schema "core"
$.ref("tasks").name           // → name field of array elements in "tasks"
$.ref("config").db.host       // → deep path into nested object
```

### Entry access in $.map callback

Inside `$.map(source, entry => ...)`, `entry` supports property chaining to access fields of the current dict/array element:

```typescript
$.map($.ref("endpoints"), e =>
    $.fn(e.request, e.response)  // e.request = request field of current entry
)
```

---

## Patterns — Simple to Complex

### 1. Basic schema (no dependencies)

```typescript
const Config = schema()
    .field("host", ty.string)
    .field("port", ty.number)
    .field("debug", ty.boolean)
    .done();

const config = Config
    .defineHost("localhost")
    .definePort(3000)
    .defineDebug(true)
    .build();
```

### 2. Constrained dict keys from object ($.ref + $.keysOf + $.record)

```typescript
const System = schema()
    .field("features", ty.object({ darkMode: ty.boolean, i18n: ty.boolean }))
    .field("labels", $ => $.record($.keysOf($.ref("features")), $.string))
    .done();

// labels keys: "darkMode" | "i18n" — constrained to features keys
System.defineFeatures({ darkMode: true, i18n: false })
    .defineLabels({ darkMode: "Dark Mode", i18n: "Internationalization" })
    .build();
```

### 3. Constrained dict keys from array elements

```typescript
const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("perms", $ => $.record($.keysOf($.ref("roles")), $.type<boolean>()))
    .done();

// No `as const` needed. perms keys inferred from actual values.
RBAC.defineRoles(["admin", "editor", "viewer"])
    .definePerms({ admin: true, editor: true, viewer: false })
    .build();
```

### 4. Constrained dict keys from string value

```typescript
const NS = schema()
    .field("tenant", ty.string)
    .field("quota", $ => $.record($.keysOf($.ref("tenant")), $.number))
    .done();

// quota has exactly one key: the tenant string value
NS.defineTenant("acme").defineQuota({ acme: 42 }).build();
```

### 5. Per-key projection with $.map (replaces mapped types)

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

API.defineEndpoints({
        getUser:   { request: ty.type<{ id: string }>(), response: ty.type<{ name: string }>() },
        listUsers: { request: ty.type<{ page: number }>(), response: ty.type<{ users: string[] }>() },
    })
    .defineHandlers({
        getUser:   (req) => ({ name: `User ${req.id}` }),         // req: { id: string }
        listUsers: (req) => ({ users: [`page${req.page}`] }),     // req: { page: number }
    })
    .build();
```

### 6. Map over array with deep path

```typescript
const Pipeline = schema()
    .field("tasks", ty.array(ty.object({
        name: ty.string,
        input: ty.desc,
        output: ty.desc,
    })))
    .field("processors", $ => $.map($.ref("tasks").name, e =>
        $.fn(e.input, e.output),
    ))
    .done();

// $.ref("tasks").name → keys from the name field of each array element
Pipeline.defineTasks([
        { name: "resize", input: ty.type<{ url: string }>(), output: ty.type<{ url: string }>() },
        { name: "compress", input: ty.type<{ data: string }>(), output: ty.type<{ result: string }>() },
    ])
    .defineProcessors({
        resize:   (input) => ({ url: `done:${input.url}` }),
        compress: (input) => ({ result: input.data.slice(0, 10) }),
    })
    .build();
```

### 7. Type catalog with $.access (type-level join)

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

// $.access($.ref("types"), method.input) resolves type name → concrete type
API.defineTypes({
        user:    ty.object({ id: ty.number, name: ty.string }),
        balance: ty.object({ userId: ty.number, amount: ty.number }),
    })
    .defineMethods({
        getUser:    { input: "user",    output: "user" },
        getBalance: { input: "user",    output: "balance" },
    })
    .defineHandlers({
        getUser:    (u) => ({ id: u.id, name: u.name.toUpperCase() }),   // u: { id: number, name: string }
        getBalance: (u) => ({ userId: u.id, amount: 100 }),              // returns { userId: number, amount: number }
    })
    .build();
```

### 8. Nested schema composition

```typescript
const Core = schema()
    .field("events", ty.record(ty.object({ payload: ty.desc, response: ty.desc })))
    .field("handlers", $ => $.map($.ref("events"), e => $.fn(e.payload, e.response)));

const App = schema()
    .field("core", Core)  // embed as nested schema (no .done())
    .field("loggers", $ => $.map($.ref("core").events, e =>
        $.fn(e.payload, ty.string),
    ))
    .done();

// defineCore opens an inner SmartBuilder
App.defineCore(b => b
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
    })
    .build();
```

### 9. Schema-level recursion with $.self()

```typescript
const Tree = schema()
    .field("id", ty.string)
    .field("children", $ => $.array($.self()))
    .done();

// children: Array<{ id: string, children: ... }> — recursive
Tree.defineNodeId("root")
    .defineChildren([
        { nodeId: "child-1", children: [] },
        { nodeId: "child-2", children: [{ nodeId: "gc", children: [] }] },
    ])
    .build();

// Or with inner builder:
Tree.defineNodeId("root")
    .defineChildren(b => b
        .add(b => b.defineNodeId("child-1").defineChildren([]).build())
        .done()
    )
    .build();
```

### 10. Object-level recursion with ty.self()

```typescript
const UI = schema()
    .field("root", ty.object({
        type: ty.string,
        props: ty.record(ty.string),
        children: ty.array(ty.self()),  // ty.self() = this object, not the schema
    }))
    .done();

UI.defineRoot({
        type: "Container",
        props: { direction: "column" },
        children: [{
            type: "Text",
            props: { content: "Hello" },
            children: [],
        }],
    })
    .build();
```

### 11. Merge / intersection

```typescript
const NS = schema()
    .field("tenant", ty.string)
    .field("config", $ => $.merge(
        $.type<{ version: number }>(),
        $.record($.keysOf($.ref("tenant")), $.string),
    ))
    .done();

// config = { version: number } & { [tenant]: string }
NS.defineTenant("acme")
    .defineConfig({ version: 1, acme: "enterprise" })
    .build();
```

### 12. FSM pattern

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

Machine.defineStates({
        red:    { on: { TIMER: "green" },  data: ty.object({ carsWaiting: ty.number }) },
        green:  { on: { TIMER: "yellow" }, data: ty.object({ carsPassed: ty.number }) },
        yellow: { on: { TIMER: "red" },    data: ty.type<null>() },
    })
    .defineLogic({
        red:    { send: (e) => {}, render: (d) => `${d.carsWaiting} waiting` },
        green:  { send: (e) => {}, render: (d) => `${d.carsPassed} passed` },
        yellow: { send: (e) => {}, render: () => `slow down` },
    })
    .build();
```

### 13. Pipeline pattern

```typescript
const Pipeline = schema()
    .field("registry", ty.record(ty.desc))
    .field("steps", $ => $.array(ty.object({
        from: $.keysOf($.ref("registry")),
        to:   $.keysOf($.ref("registry")),
    })))
    .field("handlers", $ => $.map($.ref("steps"), step =>
        $.fn($.access($.ref("registry"), step.from), $.access($.ref("registry"), step.to)),
    ))
    .done();

Pipeline.defineRegistry({ rawText: ty.string, tokens: ty.array(ty.string), count: ty.number })
    .defineSteps([{ from: "rawText", to: "tokens" }, { from: "tokens", to: "count" }])
    .defineHandlers([(text) => text.split(" "), (tokens) => tokens.length])
    .build();
```

### 14. Worker queue with async handlers

```typescript
const Contracts = schema()
    .field("tasks", ty.record(ty.object({ input: ty.desc, output: ty.desc })));

const Worker = schema()
    .field("contracts", Contracts)
    .field("executors", $ => $.map($.ref("contracts").tasks, task =>
        $.fn(task.input, $.promise(task.output)),
    ));

Worker.done()
    .defineContracts({
        tasks: {
            fetchUser: {
                input: ty.object({ id: ty.number }),
                output: ty.object({ name: ty.string }),
            },
        },
    })
    .defineExecutors({
        fetchUser: async (input) => ({ name: `User ${input.id}` }),
    })
    .build();
```

### 15. Dynamic form builder

```typescript
const TypedForm = schema()
    .field("typeMap", ty.record(ty.desc))
    .field("fields", $ => $.record($.keysOf($.ref("typeMap"))))
    .field("values", $ => $.map($.ref("fields"), field =>
        $.access($.ref("typeMap"), field),
    ))
    .done();

TypedForm.defineTypeMap({ string: ty.string, number: ty.number, boolean: ty.boolean })
    .defineFields({ username: "string", age: "number", active: "boolean" })
    .defineValues({ username: "alice", age: 28, active: true })
    .build();
```

---

## Key Rules

1. Use `schema().field(...).done()` to create schemas. `.done()` finalizes into SmartBuilder.
2. For nested schema embedding, pass the SchemaDef **without** `.done()`: `.field("core", CoreSchemaDef)`.
3. Use `ty.desc` when consumers provide type descriptors at build time (e.g., `ty.object({...})` or `ty.type<T>()`).
4. `$.ref("field")` creates a dependency — `defineField()` must be called before dependent fields become available.
5. `$.keysOf()` extracts keys from any type: string value → itself, `string[]` → elements, `Record<K,V>` → `keyof`.
6. `$.map(source, entry => ...)` iterates dict/array per key; `entry.field` accesses each element's fields.
7. `$.access(tag, keyTag)` resolves a type from a dictionary by key — the type-level equivalent of `dict[key]`.
8. `$.self()` for schema recursion (whole schema output). `ty.self()` for object recursion (current `ty.object` shape).
9. Inner builders: `(b, ctx) => ...` — second parameter `ctx` contains all previously defined fields.
10. RefTag chaining: `$.ref("nested").deep.path` for deep references into nested structures.
11. `MakeBuilder<T>()` is available for simple interface-to-builder conversion (no dependencies, no schema needed).
