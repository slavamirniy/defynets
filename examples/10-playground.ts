/**
 * Example 10 — Playground
 *
 * Progressive examples that build on each other, from $.ref to ty.map
 * to ty.access to ty.self — each adding one new concept.
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
//  2. ty.record + ty.keysOf — constrained dictionary keys
// ============================================================
//
//  ty.keysOf($.ref("X")) extracts keys from field X.
//  ty.record(keys, valueType) creates a dictionary constrained to those keys.

const Permissions = schema()
    .field("roles", ty.array(ty.string))
    .field("access", $ => ty.record(ty.keysOf($.ref("roles")), ty.boolean))
    .done();

const perms = Permissions
    .defineRoles(["admin", "editor", "viewer"])
    // ↓ defineAccess appeared — keys must be exactly "admin" | "editor" | "viewer"
    .defineAccess({ admin: true, editor: true, viewer: false })
    .build();

console.log("2.", perms);

// ▸ Try this: add "guest" to defineRoles array — TS will demand it in defineAccess.
// ▸ Try this: add a typo key like "adm1n" in defineAccess — TS error.

// ============================================================
//  3. ty.map — per-key projection
// ============================================================
//
//  ty.map(source, e => ...) iterates over source keys.
//  'e' exposes the fields of the current entry (e.g., e.request).
//  Each key gets its own unique type based on its entry data.

const Api = schema()
    .field("endpoints", ty.record(ty.object({
        request:  ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => ty.map($.ref("endpoints"), e => 
        ty.fn(e.request, e.response)
    ))
    .done();

const api = Api
    .defineEndpoints({
        getUser:  { request: ty.type<{ id: number }>(),    response: ty.type<{ name: string }>() },
        search:   { request: ty.type<{ query: string }>(), response: ty.type<{ results: string[] }>() },
    })
    // ↓ Each handler is fully typed based on its endpoint definition
    .defineHandlers({
        getUser: (req) => ({ name: `User ${req.id}` }),
        search:  (req) => ({ results: [`Result for ${req.query}`] }),
    })
    .build();

console.log("3.", Object.keys(api.handlers));

// ▸ Try this: hover over 'req' in getUser — it's { id: number }.
// ▸ Try this: return a number from getUser — TS error, must be { name: string }.

// ============================================================
//  4. ty.access — type catalog lookup
// ============================================================
//
//  ty.access(registry, key) looks up a type in a registry by key.
//  This allows defining types once and referencing them by name.

const TypedApi = schema()
    .field("types", ty.record(ty.desc))
    .field("methods", $ => ty.record(ty.object({
        input:  ty.keysOf($.ref("types")),
        output: ty.keysOf($.ref("types")),
    })))
    .field("handlers", $ => ty.map($.ref("methods"), m =>
        ty.fn(
            ty.access($.ref("types"), m.input),
            ty.access($.ref("types"), m.output)
        )
    ))
    .done();

const typed = TypedApi
    .defineTypes({
        user:    ty.object({ id: ty.number, name: ty.string }),
        post:    ty.object({ title: ty.string, body: ty.string }),
        status:  ty.type<boolean>(),
    })
    .defineMethods({
        getUser:    { input: "user", output: "user" },
        createPost: { input: "post", output: "status" },
    })
    .defineHandlers({
        // u is { id: number, name: string }
        getUser:    (u) => ({ id: u.id, name: u.name.toUpperCase() }),
        // p is { title: string, body: string }
        createPost: (p) => p.title.length > 0,
    })
    .build();

console.log("4.", Object.keys(typed.handlers));

// ▸ Try this: change getUser output to "status" in defineMethods — TS will demand a boolean return in defineHandlers.
// ▸ Try this: add a method with input: "nonexistent" — TS error, not a valid type name.

// ============================================================
//  5. ty.self() — recursive objects
// ============================================================
//
//  ty.self() inside ty.object() refers to the object being defined.
//  Allows deep recursive structures like trees.

const Tree = schema()
    .field("node", ty.object({
        label: ty.string,
        children: ty.array(ty.self())
    }))
    .done();

const tree = Tree
    .defineNode({
        label: "root",
        children: [
            { label: "child-1", children: [] },
            { label: "child-2", children: [
                { label: "grandchild", children: [] }
            ] }
        ]
    })
    .build();

console.log("5.", tree.node.label, "has", tree.node.children.length, "children");

// ▸ Try this: add a typo like 'ch1ldren' to grandchild — TS error, excess property check works at any depth.

// ============================================================
//  6. Combined Example — RPC + Recursive Workflows
// ============================================================

const RoutedRPC = schema()
    .field("types",      ty.record(ty.desc))
    .field("methods",    $ => ty.record(ty.object({
        input:  ty.keysOf($.ref("types")),
        output: ty.keysOf($.ref("types")),
    })))
    .field("handlers",   $ => ty.map($.ref("methods"), m =>
        ty.fn(ty.access($.ref("types"), m.input), ty.access($.ref("types"), m.output))
    ))
    .field("routes",     $ => ty.array(ty.keysOf($.ref("methods"))))
    .done();

const rpcApp = RoutedRPC
    .defineTypes(b => b
        .entry("User", ty.object({ id: ty.number, name: ty.string }))
        .entry("Post", ty.object({ title: ty.string, authorId: ty.number }))
        .done()
    )
    .defineMethods(b => b
        .entry("getUser",    { input: "User", output: "User" })
        .entry("createPost", { input: "Post", output: "Post" })
        .done()
    )
    .defineHandlers({
        getUser:    (u) => u,
        createPost: (p) => p,
    })
    .defineRoutes(["getUser", "createPost"])
    .build();

console.log("6.", {
    types: Object.keys(rpcApp.types),
    methods: Object.keys(rpcApp.methods),
    routes: rpcApp.routes,
});

// ============================================================
//  7. Recursive + map + access — Complex Component System
// ============================================================

const UI = schema()
    .field("propTypes", ty.record(ty.desc))
    .field("components", $ => ty.record(ty.object({
        props: ty.keysOf($.ref("propTypes")),
    })))
    .field("renderers", $ => ty.map($.ref("components"), c =>
        ty.fn(
            // props object
            ty.access($.ref("propTypes"), c.props),
            // returns a virtual DOM node (recursive)
            ty.object({
                type: ty.string,
                children: ty.array(ty.self())
            })
        )
    ))
    .done();

const ui = UI
    .definePropTypes({
        BoxProps:  ty.object({ direction: ty.type<"row" | "column">(), gap: ty.number }),
        TextProps: ty.object({ content: ty.string, size: ty.number }),
    })
    .defineComponents({
        Box:  { props: "BoxProps" },
        Text: { props: "TextProps" },
    })
    .defineRenderers({
        Box: (props) => ({
            type: "div",
            children: [] // recursive children allowed here
        }),
        Text: (props) => ({
            type: "span",
            children: []
        }),
    })
    .build();

console.log("7.", Object.keys(ui.renderers));
