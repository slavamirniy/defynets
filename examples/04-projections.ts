/**
 * Example 4 — Per-Key Projection & Inner Builders
 *
 * Shows the most powerful dictionary pattern: per-key projection with $.map.
 * Each dictionary value's TYPE depends on the specific key's entry data.
 *
 * Key concepts:
 *   - $.map($.ref("ref"), e => ...) — per-key projection
 *   - e.field                       — access entry field (auto-unwraps TypeTag)
 *   - $.fn(input, output)           — typed function per entry
 *   - Inner builders: b => b.entry(...).done()
 */
import { schema, ty } from "../src";

// ============================================================
//  Scenario: REST API with typed handlers
// ============================================================
//
//  1. Define API endpoints (each has request/response type descriptors)
//  2. Generate typed handlers — each handler's signature matches its endpoint
//
//  endpoint "createUser":
//    request  = { name: string; email: string }
//    response = { id: string; name: string }
//  →
//  handler "createUser": (input: { name: string; email: string }) => { id: string; name: string }

const ApiRouter = schema()
    .field("endpoints", ty.record(ty.object({
        request: ty.desc,
        response: ty.desc,
        method: ty.type<"GET" | "POST" | "PUT" | "DELETE">(),
    })))
    // Per-key projection: each handler is a function typed by its endpoint
    .field("handlers", $ => $.map($.ref("endpoints"), e =>
        $.fn(e.request, e.response),
    ))
    .done();

const api = ApiRouter
    .defineEndpoints({
        getUsers: {
            request: ty.type<{ page: number }>(),
            response: ty.type<{ users: string[]; total: number }>(),
            method: "GET",
        },
        createUser: {
            request: ty.type<{ name: string; email: string }>(),
            response: ty.type<{ id: string; name: string }>(),
            method: "POST",
        },
        deleteUser: {
            request: ty.type<{ id: string }>(),
            response: ty.type<{ success: boolean }>(),
            method: "DELETE",
        },
    })
    // ↓ Each handler is fully typed per endpoint:
    //   getUsers:    (input: { page: number }) => { users: string[]; total: number }
    //   createUser:  (input: { name: string; email: string }) => { id: string; name: string }
    //   deleteUser:  (input: { id: string }) => { success: boolean }
    .defineHandlers({
        getUsers: (req) => ({ users: [`page-${req.page}`], total: 42 }),
        createUser: (req) => ({ id: "u-123", name: req.name }),
        deleteUser: (req) => ({ success: req.id !== "" }),
    })
    .build();

console.log("API handlers:", Object.keys(api.handlers));


// ============================================================
//  Per-key projection from array source
// ============================================================
//
//  Same concept but tasks is an array.
//  $.ref("tasks").name → keys = name values ("resize", "compress")
//  e.input, e.output → typed per entry

const ArrayPipeline = schema()
    .field("tasks", ty.array(ty.object({
        name: ty.string,
        input: ty.desc,
        output: ty.desc,
    })))
    .field("processors", $ => $.map(
        $.ref("tasks").name,
        e => $.fn(e.input, e.output)
    ))
    .done();

const pipeline = ArrayPipeline
    .defineTasks([
        {
            name: "resize",
            input: ty.type<{ url: string; width: number }>(),
            output: ty.type<{ url: string }>(),
        },
        {
            name: "compress",
            input: ty.type<{ data: string; level: number }>(),
            output: ty.type<{ compressed: string }>(),
        },
    ])
    // ↓ keys: "resize" | "compress", each typed per task
    .defineProcessors({
        resize: (input) => ({ url: `resized:${input.url}` }),
        compress: (input) => ({ compressed: `zipped-${input.level}:${input.data}` }),
    })
    .build();

console.log("Pipeline processors:", Object.keys(pipeline.processors));


// ============================================================
//  Inner builders — callback syntax
// ============================================================
//
//  Instead of passing object literals, use inner builders
//  for step-by-step construction with full type safety.
//
//  dict  → b.entry("key", value).done()
//  array → b.add(value).done()
//  obj   → b.defineX(v).build()

const InnerBuilderDemo = schema()
    .field("tasks", ty.record(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))
    .field("pipeline", $ => $.array($.object({
        task: $.keysOf($.ref("tasks")),
        priority: ty.type<"low" | "medium" | "high">(),
    })))
    .done();

const demo = InnerBuilderDemo
    // dict inner builder: .entry(key, value).done()
    .defineTasks(b => b
        .entry("analyze", d => d
            .defineInput(ty.type<{ text: string }>())
            .defineOutput(ty.type<{ sentiment: number }>())
            .build(),
        )
        .entry("summarize", d => d
            .defineInput(ty.type<{ text: string; maxLen: number }>())
            .defineOutput(ty.type<{ summary: string }>())
            .build(),
        )
        .done(),
    )
    // array inner builder: .add(value).done()
    .definePipeline(b => b
        .add(d => d.defineTask("analyze").definePriority("high").build())
        .add(d => d.defineTask("summarize").definePriority("medium").build())
        .done(),
    )
    .build();

console.log("Inner builder demo:", demo);
