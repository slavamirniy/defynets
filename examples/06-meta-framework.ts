/**
 * Example 6 — Nested Schema Composition
 *
 * Config-first architecture where schemas embed other schemas as fields.
 * Types propagate across nesting levels: outer fields reference inner fields.
 *
 * Architecture:
 *   CoreFramework (SchemaDef) — events + handlers (internal dep: handlers → events)
 *   Application (SchemaDef)   — embeds CoreFramework as "core" field
 *                                + loggers, metrics referencing core.events
 *
 * Key features demonstrated:
 *   1. .field("core", CoreFramework) — nested schema as a field
 *   2. $.ref("core").events         — deep reference into nested schema
 *   3. Inner SmartBuilder           — defineCore(b => b.defineEvents(...).defineHandlers(...).build())
 *   4. e.payload / e.response       — entry-scoped field access through nesting
 */
import { schema, ty } from "../src";

// ============================================================
//  Module: Core Framework (reusable, NOT .done())
// ============================================================
// Defines events with payload/response descriptors.
// Handlers depend on events (internal dependency).

const CoreFramework = schema()
    .field("events", ty.record(ty.object({
        payload: ty.desc,
        response: ty.desc,
    })))
    .field("handlers", $ => $.map($.ref("events"), event =>
        $.fn(event.payload, event.response),
    ));

// ============================================================
//  Application: embeds CoreFramework + adds cross-cutting concerns
// ============================================================

const ApplicationDef = schema()
    // ▼ Nested schema — becomes a single "core" field
    .field("core", CoreFramework)

    // ▼ Outer fields reference inner schema's structure
    //   $.ref("core").events → keys from core.events dict
    //   event.payload → payload field of each event entry
    .field("loggers", $ => $.map($.ref("core").events, event =>
        $.fn(event.payload, ty.string),
    ))

    .field("metrics", $ => $.map($.ref("core").events, event =>
        $.object({
            track: $.fn(event.payload, ty.type<void>()),
            format: $.fn(event.response, ty.string),
        }),
    ));

const Application = ApplicationDef.done();

// ============================================================
//  Build: inner SmartBuilder enforces dependency order
// ============================================================

const app = Application
    // defineCore opens a SmartBuilder for CoreFramework
    // → must define events BEFORE handlers (dep tracking works inside)
    .defineCore(b => b
        .defineEvents({
            orderCreated: {
                payload: ty.object({
                    userId: ty.string,
                    items: ty.array(ty.object({
                        sku: ty.string,
                        qty: ty.number,
                        price: ty.number,
                    })),
                }),
                response: ty.object({ orderId: ty.string, total: ty.number }),
            },
            paymentProcessed: {
                payload: ty.object({
                    orderId: ty.string,
                    amount: ty.number,
                    method: ty.type<"card" | "crypto">(),
                }),
                response: ty.object({
                    transactionId: ty.string,
                    status: ty.type<"ok" | "fail">(),
                }),
            },
        })
        .defineHandlers({
            orderCreated: (ev) => ({
                orderId: `ORD-${ev.userId}`,
                total: ev.items.reduce((s, i) => s + i.qty * i.price, 0),
            }),
            paymentProcessed: (ev) => ({
                transactionId: `TX-${ev.orderId}`,
                status: ev.amount > 0 ? "ok" as const : "fail" as const,
            }),
        })
        .build()
    )

    // Loggers — typed per event: (payload) → string
    .defineLoggers({
        orderCreated: (ev) => `Order by ${ev.userId}: ${ev.items.length} items`,
        paymentProcessed: (ev) => `Payment ${ev.orderId}: $${ev.amount}`,
    })

    // Metrics — typed per event: { track: (payload) → void, format: (response) → string }
    .defineMetrics({
        orderCreated: {
            track: (ev) => { console.log("items:", ev.items.length); },
            format: (res) => `Order ${res.orderId} total=${res.total}`,
        },
        paymentProcessed: {
            track: (ev) => { console.log("method:", ev.method); },
            format: (res) => `Tx ${res.transactionId}: ${res.status}`,
        },
    })

    .build();

console.log("App:", {
    events: Object.keys(app.core.events),
    handlers: Object.keys(app.core.handlers),
    loggers: Object.keys(app.loggers),
    metrics: Object.keys(app.metrics),
});

// ============================================================
//  Two-level nesting: Platform embeds Application schema
// ============================================================
// Shows that nesting is recursive — schemas can embed schemas
// that already embed schemas.

const Observability = schema()
    .field("alerts", ty.record(ty.object({
        threshold: ty.number,
        message: ty.string,
    })))
    .field("notifiers", $ => $.map($.ref("alerts"), alert =>
        $.fn(ty.object({ value: ty.number }), ty.boolean),
    ));

const Platform = schema()
    .field("app", ApplicationDef)
    .field("observability", Observability)
    .field("appLoggerNames", $ => $.record($.keysOf($.ref("app").loggers), ty.string))
    .field("alertChannels", $ => $.record($.keysOf($.ref("observability").alerts), ty.string))
    .done();

// ============================================================
//  Plugin chaining (alternative pattern — flat composition)
// ============================================================
// The same CoreFramework can be extended via .field() chaining
// WITHOUT nesting. Each .field() returns a new SchemaDef
// that knows all previous fields.

const WithLogging = CoreFramework
    .field("loggers", $ => $.map($.ref("events"), event =>
        $.fn(event.payload, ty.string),
    ));

const FullFramework = WithLogging
    .field("validators", $ => $.map($.ref("events"), event =>
        $.fn(event.payload, ty.boolean),
    ))
    .done();

const flat = FullFramework
    .defineEvents({
        ping: {
            payload: ty.object({ host: ty.string }),
            response: ty.object({ latency: ty.number }),
        },
    })
    .defineHandlers({
        ping: (ev) => ({ latency: ev.host.length }),
    })
    .defineLoggers({
        ping: (ev) => `Ping ${ev.host}`,
    })
    .defineValidators({
        ping: (ev) => ev.host.length > 0,
    })
    .build();

console.log("Flat:", Object.keys(flat));
