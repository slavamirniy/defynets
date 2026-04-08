/**
 * Example 7 — Type Catalog with Lookup
 *
 * Define a catalog of named types once, then reference them by name
 * in method definitions. `$$.lookup("types", "input")` resolves
 * the type name to the actual concrete type.
 *
 * Key features demonstrated:
 *   1. ty.dict(ty.desc) as a type registry
 *   2. $.from("types") inside object fields — constrains values to type names
 *   3. $$.lookup("types", "input") — type-level join: entry.input → types[entry.input]
 *   4. Per-method typed handlers via Lookup + Fn
 */
import { schema, ty } from "../src";

// ============================================================
//  Type Catalog API
// ============================================================
// "types" is the catalog — named type descriptors.
// "methods" defines API methods — each picks input/output from the catalog.
// "handlers" are typed per-method based on the resolved types.

const API = schema()
    .field("types", ty.dict(ty.desc))
    .field("methods", $ => $.dict($.object({
        input: $.from("types"),
        output: $.from("types"),
    })))
    .field("handlers", $ => $.dict($.from("methods"), $$ =>
        $$.fn($$.lookup("types", "input"), $$.lookup("types", "output")),
    ))
    .done();

// ============================================================
//  Usage: define types once, reference everywhere
// ============================================================

const api = API
    .defineTypes({
        user: ty.object({
            id: ty.number,
            userName: ty.string,
        }),
        balance: ty.object({
            userId: ty.number,
            amount: ty.number,
            currency: ty.string,
        }),
        status: ty.object({
            online: ty.boolean,
            lastSeen: ty.string,
        }),
    })
    .defineMethods({
        getUser:      { input: "user",    output: "user" },
        getBalance:   { input: "user",    output: "balance" },
        getStatus:    { input: "user",    output: "status" },
        topUp:        { input: "balance", output: "balance" },
        // { input: "nonexistent", ... }  ← TS error: not a type name
    })
    .defineHandlers({
        getUser: (input) => ({
            id: input.id,
            //   ^^^^^^^^ input: { id: number, userName: string } — from "user" type
            userName: input.userName.toUpperCase(),
        }),
        getBalance: (input) => ({
            userId: input.id,
            //      ^^^^^^^^ input: { id: number, userName: string } — from "user"
            amount: 100,
            currency: "USD",
            //        ^^^^^ output: { userId: number, amount: number, currency: string } — from "balance"
        }),
        getStatus: (input) => ({
            online: input.id > 0,
            lastSeen: `User ${input.userName}`,
        }),
        topUp: (input) => ({
            userId: input.userId,
            //      ^^^^^^^^^^^^^ input: { userId: number, amount: number, currency: string } — from "balance"
            amount: input.amount + 50,
            currency: input.currency,
        }),
    })
    .build();

console.log("API methods:", Object.keys(api.methods));
console.log("Types:", Object.keys(api.types));
console.log("getUser result:", api.handlers.getUser({ id: 1, userName: "alice" }));
console.log("getBalance result:", api.handlers.getBalance({ id: 1, userName: "alice" }));
console.log("topUp result:", api.handlers.topUp({ userId: 1, amount: 100, currency: "USD" }));


// ============================================================
//  With routes — referencing methods
// ============================================================

const RoutedAPI = schema()
    .field("types", ty.dict(ty.desc))
    .field("methods", $ => $.dict($.object({
        input: $.from("types"),
        output: $.from("types"),
        path: $.string,
    })))
    .field("handlers", $ => $.dict($.from("methods"), $$ =>
        $$.fn($$.lookup("types", "input"), $$.lookup("types", "output")),
    ))
    .field("routes", $ => $.array($.from("methods")))
    .done();

const routed = RoutedAPI
    .defineTypes({
        query: ty.object({ q: ty.string, limit: ty.number }),
        results: ty.object({ items: ty.array(ty.string), total: ty.number }),
    })
    .defineMethods({
        search: { input: "query", output: "results", path: "/api/search" },
    })
    .defineHandlers({
        search: (q) => ({
            items: [q.q],
            total: q.limit,
        }),
    })
    .defineRoutes(["search"])
    .build();

console.log("Routes:", routed.routes);
console.log("Search:", routed.handlers.search({ q: "hello", limit: 10 }));
