# SKILL: defynets — Schema-Driven Builder System

## What is defynets?

`defynets` is a TypeScript library that generates **dependency-aware, fully-typed builders** from declarative schemas. It uses Higher-Kinded Types (HKT) at the type level to track field dependencies, enforce definition order, and provide IDE autocomplete at every step.

**Core idea:** You declare a schema describing fields and their relationships. The library gives you a builder where `defineX()` methods appear only when `X`'s dependencies are satisfied, and `build()` appears only when all fields are defined.

## When to Use

Use `defynets` when generating code that needs:
- A fluent builder pattern with compile-time safety
- Fields that reference or depend on each other
- Dictionaries with keys derived from other fields
- Per-key typed projections (e.g., handlers typed per endpoint)
- Meta-schemas where users define types at build time

## Installation

```bash
npm i git:slavamirniy/defynets
```

## Core API

### Imports

```typescript
import { schema, ty, MakeBuilder, MakeDepBuilder } from "defynets";
```

### Simple Builder (no dependencies)

```typescript
const result = MakeBuilder<{ name: string; age: number }>()
  .defineName("Alice")
  .defineAge(30)
  .build();
// { name: "Alice", age: 30 }
```

### Schema Builder (with dependencies)

```typescript
const App = schema()
  .field("name", ty.string)
  .field("greeting", $ => $.ref("name"))  // depends on "name"
  .done();  // → SmartBuilder

const result = App
  .defineName("world")      // defineGreeting not yet visible
  .defineGreeting("hello")  // now visible (name is defined)
  .build();
```

## The `ty` DSL — Type Definitions

| Method | Type | Notes |
|--------|------|-------|
| `ty.string` | `string` | |
| `ty.number` | `number` | |
| `ty.boolean` | `boolean` | |
| `ty.type<T>()` | `T` | Explicit TS type |
| `ty.desc` | `TypeTag<any>` | Type descriptor slot for meta-schemas |
| `ty.ref("key")` | Value of `key` | Creates dependency on `key` |
| `ty.from("key", ...path)` | Key source | For dict keys and value references |
| `ty.object({ k: ty.X })` | `{ k: X }` | Nested object |
| `ty.array(ty.X)` | `readonly X[]` | Array |
| `ty.nullable(ty.X)` | `X \| null` | Nullable |
| `ty.dict(...)` | `Record<K, V>` | Dictionary (see patterns below) |
| `ty.merge(A, B)` | `A & B` | Intersection |
| `ty.oneOf(A, B)` | `A \| B` | Union |
| `ty.fn(In, Out)` | `(input: In) => Out` | Function type |

## Scoped Context (`$`)

Inside `schema().field("name", $ => ...)`, the `$` parameter is a `ScopedTy` — same methods as `ty` but with autocomplete constrained to previously defined fields:

```typescript
schema()
  .field("game", ty.string)
  .field("data", $ => $.ref("game"))
  //                      ^^^^ autocomplete: only "game"
```

## Dict Patterns

### 1. Free keys

```typescript
.field("config", ty.dict(ty.string))
// defineConfig({ anyKey: "value" })
```

### 2. Keys from object (`keyof`)

```typescript
.field("defaults", ty.object({ theme: ty.string, lang: ty.string }))
.field("overrides", $ => $.dict($.from("defaults"), $.nullable($.string)))
// defineOverrides({ theme: "dark", lang: null })
//                   ^^^^^ only "theme" | "lang" allowed
```

### 3. Keys from string array

```typescript
.field("roles", ty.array(ty.string))
.field("permissions", $ => $.dict($.from("roles"), $.type<boolean>()))
// defineRoles(["admin", "editor"])
// definePermissions({ admin: true, editor: false })
```

### 4. Keys from string value

```typescript
.field("tenant", ty.string)
.field("data", $ => $.dict($.from("tenant"), $.number))
// defineTenant("acme") → defineData({ acme: 42 })
```

### 5. Keys from deep path

```typescript
.field("tasks", ty.dict(ty.object({
    name: ty.string,
    input: ty.desc,
    output: ty.desc,
})))
.field("handlers", $ => $.dict($.from("tasks", "name"), $$ =>
    $$.fn($$("input"), $$("output")),
))
```

Each path segment in `$.from("tasks", "name")` has autocomplete based on the source field's structure.

## Per-Key Projection (`$$`)

Inside `dict(from, $$ => ...)`, `$$` is an `EntryScopedTy`:

- `$$("field")` — access entry field (callable, auto-unwraps TypeTag)
- `$$.fn(in, out)` — function type
- `$$.object(...)`, `$$.string`, etc. — standard type combinators

```typescript
.field("handlers", $ => $.dict($.from("endpoints"), $$ =>
    $$.fn($$("request"), $$("response"))
))
```

When using deep paths, `$$` gives access to the **parent object** of the key field.

## Inner Builders

Every `defineX()` accepts a callback with an inner builder:

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

## `ty.desc` — Meta-Schema Pattern

Use `ty.desc` when the builder consumer should provide type definitions:

```typescript
const TaskSystem = schema()
    .field("tasks", ty.dict(ty.object({
        input: ty.desc,    // consumer provides ty.object({...})
        output: ty.desc,
    })))
    .field("handlers", $ => $.dict($.from("tasks"), $$ =>
        $$.fn($$("input"), $$("output"))
    ))
    .done();

// Consumer:
TaskSystem
    .defineTasks({
        resize: {
            input: ty.object({ url: ty.string, width: ty.number }),
            output: ty.object({ url: ty.string }),
        },
    })
    .defineHandlers({
        resize: (input) => ({ url: `done:${input.url}` }),
        //       ^^^^^ typed: { url: string; width: number }
    })
    .build();
```

## Error Types

### `BuildNotReady<Missing>`

When `build()` is accessed before all fields are defined, TypeScript shows `BuildNotReady` with a `_missing` property listing remaining fields:

```
builder.build
//      ^^^^^ type: BuildNotReady<"workers" | "handlers">
//             _missing: "workers" | "handlers"
```

### Hidden `defineX()` methods

Fields whose dependencies aren't met are hidden from autocomplete. They automatically appear once you define the required fields.

## Multi-Level Dependencies

SmartBuilder supports arbitrary dependency depth. Fields at each "level" unlock the next:

```typescript
const System = schema()
    .field("taskTypes", ty.dict(ty.object({ input: ty.desc, output: ty.desc })))
    .field("workers", $ => $.dict($.object({ handles: $.array($.from("taskTypes")) })))
    .field("pipeline", $ => $.array($.object({ task: $.from("taskTypes"), worker: $.from("workers") })))
    .field("handlers", $ => $.dict($.from("taskTypes"), $$ => $$.fn($$("input"), $$("output"))))
    .done();

// Level 1: defineTaskTypes()
// Level 2: defineWorkers(), defineHandlers() (need taskTypes)
// Level 3: definePipeline() (needs taskTypes + workers)
```

## Advanced Types (for direct HKT usage)

When using `MakeDepBuilder<Schema>()` directly:

| Type | Description |
|------|-------------|
| `Const<T>` | Always `T`, no deps |
| `Pluck<K>` | `ctx[K]`, depends on K |
| `Merge<A, B>` | `A & B` |
| `DictFrom<K, V, Path>` | Dict with keys from `ctx[K]` |
| `DictMap<K, Proj, Path>` | Per-key projection over `ctx[K]` |
| `Fn<In, Out>` | `(input: In) => Out` |
| `Obj<Shape>` | Nested object |
| `Arr<E>` | Array |
| `Nullable<F>` | `F \| null` |
| `OneOf<A, B>` | `A \| B` |
| `DynRecord<V>` | Free-key dict |

## Common Patterns for LLM Code Generation

### Pattern: Config with environment-specific overrides

```typescript
const Config = schema()
    .field("defaults", ty.object({ port: ty.number, host: ty.string }))
    .field("overrides", $ => $.dict($.from("defaults"), $.nullable($.string)))
    .done();
```

### Pattern: RBAC system

```typescript
const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => $.dict($.from("roles"), $.type<{ read: boolean; write: boolean }>()))
    .done();
```

### Pattern: API with typed handlers

```typescript
const API = schema()
    .field("endpoints", ty.dict(ty.object({ request: ty.desc, response: ty.desc })))
    .field("handlers", $ => $.dict($.from("endpoints"), $$ => $$.fn($$("request"), $$("response"))))
    .done();
```

### Pattern: Pipeline orchestration

```typescript
const Pipeline = schema()
    .field("tasks", ty.dict(ty.object({ input: ty.desc, output: ty.desc })))
    .field("workers", $ => $.dict($.object({ handles: $.array($.from("tasks")) })))
    .field("pipeline", $ => $.array($.object({ task: $.from("tasks"), worker: $.from("workers") })))
    .done();
```

## Key Rules

1. **Field order in schema()** determines `$` autocomplete scope — each field only sees previously declared fields.
2. **Definition order in the builder** is enforced by dependencies — independent fields can be defined in any order.
3. **`ty.desc`** creates a "slot" where the builder consumer provides a type definition using `ty.object(...)` etc.
4. **`$.from()`** auto-detects key source: string → single key, string[] → elements, object → keyof, nested → deep path.
5. **`$$("field")`** inside dict projections uses callable syntax to avoid confusion with methods like `$$.fn()`.
6. **Inner builders** (callback syntax) mirror the HKT structure: Obj → `.defineX().build()`, Arr → `.add().done()`, DynRecord → `.entry().done()`.
7. **`build()`** shows `BuildNotReady<Missing>` with `_missing` field listing remaining fields when not all fields are defined.
