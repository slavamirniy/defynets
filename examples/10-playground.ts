/**
 * Example 10 — Playground
 *
 * Progressive examples that build on each other, from $.ref to $.map
 * to $.access to $.self — each adding one new concept.
 *
 * Read top to bottom. Each section has "▸ Try this" suggestions —
 * uncomment or modify and watch TypeScript react in real time.
 */
import { schema, ty } from "../src";

// ============================================================
//  1. $.ref — one field depends on another
// ============================================================
//
//  $.ref("X") means "my type comes from field X".
//  The builder hides defineGreeting until defineName is called.

const Hello = schema()
    .field("name", ty.string)
    .field("greeting", $ => $.ref("name"))
    .done();

const hello = Hello
    .defineName("world")
    // ↓ defineGreeting appeared — it expects the same type as name (string)
    .defineGreeting("world")
    .build();

console.log("1.", hello);

// ▸ Try this: remove .defineName() — defineGreeting disappears, build() shows BuildNotReady.
// ▸ Try this: pass a number to defineGreeting — TS error, must be string (same as name).


// ============================================================
//  2. $.ref + $.keysOf — constrained dictionary keys
// ============================================================
//
//  $.keysOf extracts keys from a ref:
//    string → the string itself
//    array  → element values
//    object → keyof
//
//  The result constrains which keys a record can have.

const Permissions = schema()
    .field("roles", ty.array(ty.string))
    .field("access", $ => $.record($.keysOf($.ref("roles")), ty.boolean))
    .done();

const perms = Permissions
    .defineRoles(["admin", "editor", "viewer"])
    // ↓ access keys must be exactly "admin" | "editor" | "viewer"
    .defineAccess({ admin: true, editor: true, viewer: false })
    .build();

console.log("2.", perms);

// ▸ Try this: add "hacker: true" to defineAccess — TS error, not a valid role.
// ▸ Try this: remove "viewer" from defineAccess — TS error, key "viewer" is missing.
// ▸ Try this: change defineRoles to ["read", "write"] — defineAccess now expects those keys.


// ============================================================
//  3. $.map — per-key projection (the power move)
// ============================================================
//
//  $.map iterates over a dict/array source. For each entry,
//  you get access to that entry's fields — so each key can
//  have a DIFFERENT type.
//
//  This replaces: { [K in keyof T]: (input: T[K]["in"]) => T[K]["out"] }

const Api = schema()
    .field("endpoints", ty.record(ty.object({
        request:  ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.map($.ref("endpoints"), e =>
        $.fn(e.request, e.response),
    ))
    .done();

const api = Api
    .defineEndpoints({
        getUser:  { request: ty.type<{ id: number }>(),    response: ty.type<{ name: string }>() },
        search:   { request: ty.type<{ query: string }>(), response: ty.type<{ results: string[] }>() },
    })
    .defineHandlers({
        getUser: (req) => ({ name: `User #${req.id}` }),
        //        ^^^ req: { id: number } — from getUser.request
        search:  (req) => ({ results: [req.query] }),
        //        ^^^ req: { query: string } — from search.request
    })
    .build();

console.log("3.", api.handlers.getUser({ id: 42 }));

// ▸ Try this: return { name: 123 } in getUser — TS error, must be string.
// ▸ Try this: add a third endpoint "deleteUser" — defineHandlers immediately requires it.
// ▸ Try this: change getUser.response to ty.type<{ id: number; name: string }>() —
//   the handler return type updates automatically.


// ============================================================
//  4. $.map + $.access — type catalog (type-level join)
// ============================================================
//
//  When types are in a registry and fields reference them by name,
//  $.access resolves the name to the actual type.
//
//  Think of it as: types["user"] → { id: number, name: string }

const TypedApi = schema()
    .field("types", ty.record(ty.desc))
    .field("methods", $ => $.record($.object({
        input:  $.keysOf($.ref("types")),
        output: $.keysOf($.ref("types")),
    })))
    .field("handlers", $ => $.map($.ref("methods"), m =>
        $.fn(
            $.access($.ref("types"), m.input),
            $.access($.ref("types"), m.output),
        ),
    ))
    .done();

const typed = TypedApi
    .defineTypes({
        user:    ty.object({ id: ty.number, name: ty.string }),
        post:    ty.object({ title: ty.string, body: ty.string }),
        status:  ty.type<boolean>(),
    })
    .defineMethods({
        getUser:    { input: "user",   output: "user" },
        createPost: { input: "post",   output: "status" },
    })
    .defineHandlers({
        getUser:    (u) => ({ id: u.id, name: u.name.toUpperCase() }),
        //           ^^ { id: number, name: string } — resolved from "user"
        createPost: (p) => p.title.length > 0,
        //           ^^ { title: string, body: string } — resolved from "post"
        //           returns boolean — resolved from "status"
    })
    .build();

console.log("4.", typed.handlers.getUser({ id: 1, name: "alice" }));

// ▸ Try this: change getUser input to "post" — handler now receives { title, body }.
// ▸ Try this: add a new type "comment" and a method that uses it.
// ▸ Try this: set input to "nonexistent" — TS error, not a valid type name.


// ============================================================
//  5. $.self — recursive schema
// ============================================================
//
//  $.self() references the entire schema output.
//  The builder for children is the same as the builder for the root —
//  you can nest infinitely.

const Tree = schema()
    .field("label", ty.string)
    .field("children", $ => $.array($.self()))
    .done();

const tree = Tree
    .defineLabel("root")
    .defineChildren(b => b
        .add(b => b
            .defineLabel("chapter-1")
            .defineChildren(b => b
                .add(b => b.defineLabel("section-1.1").defineChildren([]).build())
                .add(b => b.defineLabel("section-1.2").defineChildren([]).build())
                .done()
            )
            .build()
        )
        .add(b => b.defineLabel("chapter-2").defineChildren([]).build())
        .done()
    )
    .build();

console.log("5.", JSON.stringify(tree, null, 2));

// ▸ Try this: add a third level under section-1.1 — same builder, same types, infinite depth.
// ▸ Try this: pass a raw object instead of inner builder:
//   .defineChildren([{ label: "ch1", children: [{ label: "s1", children: [] }] }])
// ▸ Try this: use ty.self() inside ty.object for object-level recursion instead:
//   schema().field("root", ty.object({ name: ty.string, items: ty.array(ty.self()) })).done()


// ============================================================
//  6. Combine everything — dependency tree in action
// ============================================================
//
//  A schema with 4 dependency levels. The builder reveals methods
//  one level at a time. Watch the autocomplete progression.
//
//  Level 0:  types          (no deps)
//  Level 1:  methods        (← types)
//  Level 2:  handlers       (← methods, types)
//  Level 3:  routes         (← methods)
//
//  You cannot skip levels. TypeScript enforces the order.

const RoutedRPC = schema()
    .field("types",      ty.record(ty.desc))
    .field("methods",    $ => $.record($.object({
        input:  $.keysOf($.ref("types")),
        output: $.keysOf($.ref("types")),
        auth:   $.type<boolean>(),
    })))
    .field("handlers",   $ => $.map($.ref("methods"), method =>
        $.fn(
            $.access($.ref("types"), method.input),
            $.promise($.access($.ref("types"), method.output)),
        ),
    ))
    .field("routes",     $ => $.array($.keysOf($.ref("methods"))))
    .done();

const app = RoutedRPC
    // ┌ Available: defineTypes
    // │ Hidden:    defineMethods, defineHandlers, defineRoutes
    .defineTypes(b => b
        .entry("User", ty.object({ id: ty.number, name: ty.string }))
        .entry("Post", ty.object({ title: ty.string, authorId: ty.number }))
        .done()
    )
    // ┌ Available: defineMethods  ← unlocked!
    // │ Hidden:    defineHandlers, defineRoutes
    .defineMethods(b => b
        .entry("getUser",    { input: "User", output: "User",  auth: false })
        .entry("createPost", { input: "Post", output: "Post",  auth: true })
        .done()
    )
    // ┌ Available: defineHandlers, defineRoutes  ← both unlocked!
    .defineHandlers({
        getUser:    async (u) => ({ id: u.id, name: u.name }),
        createPost: async (p) => ({ title: p.title, authorId: p.authorId }),
    })
    .defineRoutes(["getUser", "createPost"])
    // All defined → build()
    .build();

console.log("6.", {
    types: Object.keys(app.types),
    methods: Object.keys(app.methods),
    routes: app.routes,
});

// ▸ Try this: call .defineHandlers before .defineTypes — it doesn't exist.
// ▸ Try this: hover over build before all fields are defined — BuildNotReady<"handlers" | "routes">.
// ▸ Try this: add "deleteUser" to defineMethods — defineHandlers immediately requires it.
// ▸ Try this: set route to ["nonexistent"] — TS error, must be "getUser" | "createPost".


// ============================================================
//  7. Recursive + map + access — the full combo
// ============================================================
//
//  A component system where:
//  - propTypes = type catalog
//  - components reference propTypes by name + have recursive children (ty.self)
//  - renderers are typed per-component via $.map + $.access
//
//  This is ref + keysOf + map + access + ty.self + inner builders
//  all working together.

const UI = schema()
    .field("propTypes", ty.record(ty.desc))
    .field("components", $ => $.record(ty.object({
        tag: ty.string,
        propsType: $.keysOf($.ref("propTypes")),
        children: ty.array(ty.self()),
    })))
    .field("renderers", $ => $.map($.ref("components"), comp =>
        $.fn($.access($.ref("propTypes"), comp.propsType), ty.string),
    ))
    .done();

const ui = UI
    .definePropTypes({
        BoxProps:  ty.object({ direction: ty.type<"row" | "column">(), gap: ty.number }),
        TextProps: ty.object({ content: ty.string, size: ty.number }),
    })
    .defineComponents(b => b
        .entry("header", {
            tag: "header",
            propsType: "BoxProps",
            children: [
                { tag: "h1", propsType: "TextProps", children: [] },
            ],
        })
        .entry("card", {
            tag: "div",
            propsType: "BoxProps",
            children: [
                { tag: "span", propsType: "TextProps", children: [] },
            ],
        })
        .done()
    )
    .defineRenderers({
        header: (p) => `<header dir="${p.direction}" gap=${p.gap}>`,
        //       ^^^ { direction: "row" | "column", gap: number } — from "BoxProps"
        card:   (p) => `<div dir="${p.direction}">`,
        //       ^^^ same — card also uses "BoxProps"
    })
    .build();

console.log("7.", ui.renderers.header({ direction: "row", gap: 8 }));

// ▸ Try this: change card's propsType to "TextProps" — renderer now receives { content, size }.
// ▸ Try this: add a "ButtonProps" type and a "footer" component using it.
// ▸ Try this: nest children deeper — ty.self() allows infinite recursion.
// ▸ Try this: use inner builder for children:
//   .entry("header", b => b.defineTag("header").definePropsType("BoxProps")
//     .defineChildren(b => b.add({tag:"h1", propsType:"TextProps", children:[]}).done()).build())
