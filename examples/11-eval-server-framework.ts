/**
 * Example 11 — Server Framework with $.eval()
 *
 * The "framework author" pattern: define a system where the
 * consumer chooses a type (ContextType), and every other field
 * automatically resolves to use that type.
 *
 * Key features demonstrated:
 *   1. ty.desc            — type descriptor slot (consumer fills it)
 *   2. $.eval("field")    — resolve the descriptor to a concrete type
 *   3. Dependency order   — createContext/routes unlock after ContextType
 */
import { schema, ty } from "../src";

// ── Mock external types (replace with real ones in production) ──

interface Request {
    headers: Record<string, string | undefined>;
    url: string;
    method: string;
}

interface DB {
    user: {
        findFirst(opts: { where: { id: string } }): { id: string; name: string };
        findMany(): { id: string; name: string }[];
    };
}

declare const db: DB;

// ============================================================
//  Framework Author: define the server schema
// ============================================================

const ServerCore = schema()
    // 1. Type slot — the user decides what "context" looks like
    .field("ContextType", ty.desc)

    // 2. Factory: how the server builds context for each request
    .field("createContext", $ => ty.fn(
        ty.type<Request>(),
        $.eval("ContextType"),
    ))

    // 3. Routes: each handler receives the typed context
    .field("routes", $ => ty.record(
        ty.fn($.eval("ContextType"), ty.promise(ty.type<any>())),
    ))
    .done();

// ============================================================
//  Framework User: plug in types and implementations
// ============================================================

const myServer = ServerCore
    // User decides: context = { db, userId }
    .defineContextType(ty.object({
        db: ty.type<DB>(),
        userId: ty.string,
    }))

    // createContext now expects (Request) => { db: DB, userId: string }
    .defineCreateContext((req) => ({
        db: db,
        userId: req.headers["x-user-id"] ?? "",
    }))

    // Each route handler gets ctx: { db: DB, userId: string }
    .defineRoutes({
        getUser: async (ctx) => {
            return ctx.db.user.findFirst({ where: { id: ctx.userId } });
        },
        listUsers: async (ctx) => {
            return ctx.db.user.findMany();
        },
    })
    .build();

console.log("Server:", {
    createContext: typeof myServer.createContext,
    routes: Object.keys(myServer.routes),
});

// ============================================================
//  Variation: minimal context (just a token string)
// ============================================================

const TokenServer = ServerCore
    .defineContextType(ty.string)
    .defineCreateContext((req) => req.headers["authorization"] ?? "")
    .defineRoutes({
        whoami: async (ctx) => `Token: ${ctx}`,
    })
    .build();

console.log("TokenServer routes:", Object.keys(TokenServer.routes));

// ============================================================
//  Extended server: context + middleware layer
// ============================================================

const ServerWithMiddleware = schema()
    .field("ContextType", ty.desc)
    .field("createContext", $ => ty.fn(
        ty.type<Request>(),
        $.eval("ContextType"),
    ))
    .field("middleware", $ => ty.array(
        ty.fn($.eval("ContextType"), $.eval("ContextType")),
    ))
    .field("routes", $ => ty.record(
        ty.fn($.eval("ContextType"), ty.promise(ty.type<any>())),
    ))
    .done();

const fullServer = ServerWithMiddleware
    .defineContextType(ty.object({
        db: ty.type<DB>(),
        userId: ty.string,
        role: ty.type<"admin" | "user">(),
    }))
    .defineCreateContext((req) => ({
        db: db,
        userId: req.headers["x-user-id"] ?? "",
        role: "user" as const,
    }))
    .defineMiddleware([
        (ctx) => ({ ...ctx, role: ctx.userId === "root" ? "admin" as const : "user" as const }),
    ])
    .defineRoutes({
        dashboard: async (ctx) => {
            if (ctx.role === "admin") return { admin: true };
            return { admin: false };
        },
    })
    .build();

console.log("Full server middleware count:", fullServer.middleware.length);
