/**
 * Example 3 — Dict Patterns
 *
 * Shows every way to create constrained dictionaries:
 *
 *   Pattern 1: Free keys        — ty.record(valueType)
 *   Pattern 2: Keys from object — $.record($.keysOf($.ref("obj")), valueType)
 *   Pattern 3: Keys from array  — $.record($.array($.ref("arr")), valueType)
 *   Pattern 4: Keys from string — $.record($.keysOf($.ref("str")), valueType)
 *   Pattern 5: Deep path keys   — $.record($.ref("ref").a.b, valueType)
 */
import { schema, ty } from "../src";

// ============================================================
//  Pattern 1 — Free-key dictionary
// ============================================================
//  User can use any string keys. No constraints.

const FreeDict = schema()
    .field("env", ty.record(ty.string))
    .done();

const env = FreeDict
    .defineEnv({
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgres://...",
    })
    .build();

console.log("Pattern 1:", env);


// ============================================================
//  Pattern 2 — Keys from object (keyof)
// ============================================================
//  Define a "shape" object, then a dict whose keys must match.
//  Useful for overrides, translations, feature flags.

const FeatureFlags = schema()
    .field("features", ty.object({
        darkMode: ty.boolean,
        betaAccess: ty.boolean,
        analytics: ty.boolean,
    }))
    .field("descriptions", $ => $.record($.keysOf($.ref("features")), $.string))
    .done();

const flags = FeatureFlags
    .defineFeatures({ darkMode: true, betaAccess: false, analytics: true })
    // ↓ keys: exactly "darkMode" | "betaAccess" | "analytics"
    .defineDescriptions({
        darkMode: "Enable dark color scheme",
        betaAccess: "Access to beta features",
        analytics: "Track user behavior",
    })
    .build();

console.log("Pattern 2:", flags);


// ============================================================
//  Pattern 3 — Keys from string array
// ============================================================
//  Define roles as an array, then permissions keyed by those roles.

const RBAC = schema()
    .field("roles", ty.array(ty.string))
    .field("permissions", $ => $.record($.keysOf($.ref("roles")), $.type<{
        canRead: boolean;
        canWrite: boolean;
        canDelete: boolean;
    }>()))
    .done();

const rbac = RBAC
    .defineRoles(["admin", "editor", "viewer"])
    // ↓ keys: exactly "admin" | "editor" | "viewer"
    .definePermissions({
        admin: { canRead: true, canWrite: true, canDelete: true },
        editor: { canRead: true, canWrite: true, canDelete: false },
        viewer: { canRead: true, canWrite: false, canDelete: false },
    })
    .build();

console.log("Pattern 3:", rbac);


// ============================================================
//  Pattern 4 — Keys from string value
// ============================================================
//  A single string field becomes the sole dictionary key.
//  Useful for dynamic namespacing.

const Namespace = schema()
    .field("tenant", ty.string)
    .field("config", $ => $.merge(
        $.type<{ version: number }>(),
        $.record($.keysOf($.ref("tenant")), $.string),
    ))
    .done();

const ns = Namespace
    .defineTenant("acme")
    // ↓ config = { version: number } & { acme: string }
    .defineConfig({ version: 1, acme: "enterprise" })
    .build();

console.log("Pattern 4:", ns);


// ============================================================
//  Pattern 5 — Deep path keys
// ============================================================
//  Extract keys from nested field values.
//  $.from("tasks", "input", "channel", "name")
//  → keys = values of tasks[*].input.channel.name

const Routing = schema()
    .field("channels", ty.record(ty.object({
        transport: ty.type<"http" | "ws" | "grpc">(),
        config: ty.object({
            label: ty.string,
            timeout: ty.number,
        }),
    })))
    // Keys from config.label values
    .field("timeouts", $ => $.record(
        $.access($.valuesOf($.map($.ref("channels"), c => $.access(c, ty.type<"config">()))), ty.type<"label">()),
        $.number
    ))
    .done();

const routing = Routing
    .defineChannels({
        api: {
            transport: "http",
            config: { label: "REST API", timeout: 5000 },
        },
        realtime: {
            transport: "ws",
            config: { label: "WebSocket", timeout: 30000 },
        },
    })
    // ↓ keys from label values: "REST API" | "WebSocket"
    .defineTimeouts({
        "REST API": 5000,
        "WebSocket": 30000,
    })
    .build();

console.log("Pattern 5:", routing);
