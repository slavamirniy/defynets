# defynets

**Define a schema. Get a reactive, type-safe builder.**

`defynets` is a TypeScript-first library that generates **dependency-aware builders** from declarative schemas. It uses Higher-Kinded Types (HKT) at the type level to:

- **Track dependencies** between fields automatically
- **Show only valid methods** — `defineX()` appears only when X's dependencies are satisfied
- **Infer types at every step** — full autocomplete, zero `as any`
- **Show clear errors** — `build()` displays `BuildNotReady<Missing>` with the remaining field names
- **Support nested builders** — objects, arrays, dicts via callback syntax

## Install

```bash
npm i git:slavamirniy/defynets
```

## Quick Start

### Simple Builder

Generate a fluent builder from any interface:

```typescript
import { MakeBuilder } from "defynets";

const user = MakeBuilder<{ name: string; email: string; age: number }>()
    .defineAge(30)              // ← any order
    .defineEmail("alice@x.com")
    .defineName("Alice")
    .build();
// { name: "Alice", email: "alice@x.com", age: 30 }
```

### Schema with Dependencies

Fields can reference each other. The builder enforces correct definition order:

```typescript
import { schema, ty } from "defynets";

const ProductCard = schema()
    .field("locale", ty.string)
    .field("currency", ty.string)
    .field("price", ty.number)
    // localizedTitle depends on locale
    .field("localizedTitle", $ => $.dict($.from("locale"), $.string))
    // priceLabel depends on currency
    .field("priceLabel", $ => $.merge(
        $.type<{ formatted: string }>(),
        $.dict($.from("currency"), $.string),
    ))
    .done();

const card = ProductCard
    .defineLocale("en")
    .defineCurrency("usd")
    .definePrice(99.99)
    // ↓ defineLocalizedTitle appears (locale is defined)
    .defineLocalizedTitle({ en: "Red Sneakers" })
    // ↓ definePriceLabel appears (currency is defined)
    .definePriceLabel({ formatted: "$99.99", usd: "99.99" })
    .build();
```

## Core Concepts

### The `ty` DSL

Describe field types declaratively:

| Helper | Description |
|--------|-------------|
| `ty.string`, `ty.number`, `ty.boolean` | Primitive types |
| `ty.type<T>()` | Explicit TypeScript type |
| `ty.desc` | Type descriptor slot (resolved at build time) |
| `ty.ref("key")` | Reference another field's value |
| `ty.from("ref", ...path)` | Source reference for dict keys and value access |
| `ty.object({ ... })` | Nested object with shape |
| `ty.array(element)` | Readonly array |
| `ty.nullable(inner)` | `T \| null` |
| `ty.dict(...)` | Dict — free keys, constrained keys, or per-key projection |
| `ty.merge(a, b)` | Intersection `A & B` |
| `ty.oneOf(a, b)` | Union `A \| B` |
| `ty.fn(input, output)` | Function type `(input: In) => Out` |

### Scoped Context (`$`)

Inside `schema().field("name", $ => ...)`, the `$` parameter is context-aware — only previously defined fields appear in autocomplete:

```typescript
schema()
    .field("game", ty.string)
    .field("data", $ => $.ref("game"))
    //                      ^^^^ autocomplete: only "game"
```

### Error Types

#### `BuildNotReady<Missing>`

`build()` is always visible on the builder. When not all fields are defined, it shows `BuildNotReady` with a `_missing` property:

```typescript
builder.build
//      ^^^^^ BuildNotReady<"workers" | "handlers">
//             _missing: "workers" | "handlers"
```

Once all fields are defined, `build()` becomes callable: `() => Pretty<Ctx>`.

### Dict Patterns

#### Free keys

```typescript
.field("config", ty.dict(ty.string))
// defineConfig({ anyKey: "value", ... })
```

#### Keys from object (`keyof`)

```typescript
.field("features", ty.object({ darkMode: ty.boolean, analytics: ty.boolean }))
.field("descriptions", $ => $.dict($.from("features"), $.string))
// defineDescriptions({ darkMode: "...", analytics: "..." })
//                      ^^^^^^^^ ^^^^^^^^^ — only these keys allowed
```

#### Keys from string array

```typescript
.field("roles", ty.array(ty.string))
.field("permissions", $ => $.dict($.from("roles"), $.type<boolean>()))
// defineRoles(["admin", "editor"])
// definePermissions({ admin: true, editor: false })
```

#### Keys from string value

```typescript
.field("tenant", ty.string)
.field("data", $ => $.dict($.from("tenant"), $.number))
// defineTenant("acme") → defineData({ acme: 42 })
```

#### Keys from deep path

```typescript
.field("channels", ty.dict(ty.object({
    config: ty.object({ label: ty.string, timeout: ty.number }),
})))
.field("timeouts", $ => $.dict($.from("channels", "config", "label"), $.number))
// Keys = values of channels[*].config.label
```

Path segments in `$.from()` support **autocomplete at each level**.

### Per-Key Projection (`$$`)

Inside `dict(from, $$ => ...)`, the `$$` parameter provides entry-scoped access:

```typescript
.field("endpoints", ty.dict(ty.object({
    request: ty.desc,
    response: ty.desc,
})))
.field("handlers", $ => $.dict($.from("endpoints"), $$ =>
    $$.fn($$("request"), $$("response"))
    //    ^^^^^^^^^^^^^^ callable — access entry field
    //                   auto-unwraps TypeTag → resolved type
))
```

- `$$("field")` — access entry field (callable syntax, doesn't clash with methods)
- `$$.fn(a, b)` — function type combinator
- `$$.object(...)`, `$$.array(...)`, `$$.merge(...)` — same helpers as `ty`

### Inner Builders (Callback Syntax)

Every `defineX()` accepts either a value or a callback with an inner builder:

```typescript
// Dict → .entry(key, value).done()
.defineTasks(b => b
    .entry("resize", d => d
        .defineInput(ty.object({ url: ty.string }))
        .defineOutput(ty.object({ url: ty.string }))
        .build())
    .done())

// Array → .add(value).done()
.definePipeline(b => b
    .add({ task: "resize", worker: "main" })
    .done())
```

| HKT | Inner Builder | Methods |
|-----|---------------|---------|
| `Obj<Shape>` | `ObjStepBuilder` | `.defineX(v).build()` |
| `Arr<E>` | `ArrStepBuilder` | `.add(v).done()` |
| `DynRecord<V>` | `DictStepBuilder` | `.entry(k, v).done()` |

## Full Example: Image Processing Pipeline

```typescript
import { schema, ty } from "defynets";

const ImagePipeline = schema()
    .field("taskTypes", ty.dict(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("workers", $ => $.dict($.object({
        handles: $.array($.from("taskTypes")),
        concurrency: $.type<number>(),
    })))
    .field("storages", $ => $.dict($.object({
        stores: $.array($.from("taskTypes")),
        backend: $.type<"s3" | "local" | "redis">(),
    })))
    .field("handlers", $ => $.dict($.from("taskTypes"), $$ =>
        $$.fn($$("input"), $$("output")),
    ))
    .field("pipeline", $ => $.array($.object({
        task: $.from("taskTypes"),
        worker: $.from("workers"),
        storage: $.from("storages"),
    })))
    .done();

const system = ImagePipeline
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
    .defineStorages({
        s3: { stores: ["resize", "thumbnail"], backend: "s3" },
    })
    .defineHandlers({
        resize: (input) => ({
            url: `resized:${input.url}`,
            dimensions: `${input.width}x${input.height}`,
        }),
        thumbnail: (input) => ({
            thumbUrl: `thumb:${input.url}`,
            size: 128,
        }),
    })
    .definePipeline([
        { task: "resize", worker: "imageWorker", storage: "s3" },
        { task: "thumbnail", worker: "imageWorker", storage: "s3" },
    ])
    .build();
```

TypeScript enforces:
- `handles` must be `("resize" | "thumbnail")[]`
- `task` / `worker` / `storage` in pipeline must reference defined keys
- Each handler function is typed per task (resize input ≠ thumbnail input)

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `MakeBuilder<T>()` | Simple builder from interface `T` |
| `MakeDepBuilder<S>()` | Builder from HKT schema `S` |
| `schema()` | Start a schema definition chain |
| `defineSchema(desc)` | Create builder from flat descriptor |

### Schema Chain

| Method | Description |
|--------|-------------|
| `.field(name, type)` | Add a field with `ty.*` type or `$ => ...` callback |
| `.done()` | Finalize schema → `SmartBuilder` |
| `.shape()` | Get `TypeTag<Obj<S>>` for nested schemas |

## Examples

See the [`examples/`](./examples) directory for progressive illustrations:

1. **[01-hello-world.ts](examples/01-hello-world.ts)** — MakeBuilder, schema with ty DSL
2. **[02-dependencies.ts](examples/02-dependencies.ts)** — Cross-field dependencies, ref, from, merge
3. **[03-dict-patterns.ts](examples/03-dict-patterns.ts)** — All five dict key source patterns
4. **[04-projections.ts](examples/04-projections.ts)** — Per-key projections, `$$()`, inner builders
5. **[05-full-pipeline.ts](examples/05-full-pipeline.ts)** — Complete multi-level system
6. **[06-meta-framework.ts](examples/06-meta-framework.ts)** — Abstract meta-framework: programmer defines the domain model

## License

MIT
