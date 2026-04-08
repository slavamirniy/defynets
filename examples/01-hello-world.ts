/**
 * Example 1 — First Steps
 *
 * Shows the two simplest ways to create a builder:
 *   1. MakeBuilder<Interface>() — no dependencies, any order
 *   2. schema().field(...).done() — declarative schema with ty DSL
 */
import { MakeBuilder, schema, ty } from "../src";

// ============================================================
//  1. Builder from interface
// ============================================================
//
//  MakeBuilder turns any interface into a fluent builder.
//  All defineX() methods are always available. Order doesn't matter.
//  build() appears only when every field is set.
//
//  Try removing a defineX line — build() disappears from autocomplete.
//  Try passing a wrong type — TypeScript catches it immediately.

interface UserProfile {
    name: string;
    email: string;
    age: number;
}

const alice = MakeBuilder<UserProfile>()
    .defineAge(30)              // ← any order
    .defineEmail("alice@x.com")
    .defineName("Alice")
    .build();
//  ^? { name: string; email: string; age: number }

console.log(alice);
// → { age: 30, email: "alice@x.com", name: "Alice" }


// ============================================================
//  2. Schema with ty DSL
// ============================================================
//
//  schema() + ty.* lets you describe field types declaratively.
//  This example has no cross-field dependencies — just flat fields.
//
//  Benefit over MakeBuilder: you can use ty.object(), ty.array(),
//  ty.nullable() etc. for deeply typed nested structures.

const ServerConfig = schema()
    .field("host", ty.string)
    .field("port", ty.number)
    .field("database", ty.object({
        url: ty.string,
        pool: ty.number,
    }))
    .field("features", ty.array(ty.string))
    .field("debug", ty.boolean)
    .done();

const devConfig = ServerConfig
    .defineHost("localhost")
    .definePort(3000)
    .defineDatabase({ url: "postgres://localhost/dev", pool: 5 })
    .defineFeatures(["auth", "logging", "metrics"])
    .defineDebug(true)
    .build();

console.log(devConfig);
// → { host: "localhost", port: 3000, database: { url: "...", pool: 5 }, ... }

const App = schema()
  .field("name", ty.object({ love: ty.string }))
  .field("greeting", $ => $.ref("name"))
  .done();