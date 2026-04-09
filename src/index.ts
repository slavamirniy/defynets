/**
 * @module defynets
 *
 * Define schemas with HKT type relationships.
 * Get reactive, dependency-aware, fully-typed builders.
 *
 * @example
 * ```ts
 * import { schema, ty } from "defynets";
 *
 * const App = schema()
 *   .field("name", ty.string)
 *   .field("greeting", $ => $.ref("name"))
 *   .done();
 *
 * const app = App
 *   .defineName("world")
 *   .defineGreeting("hello world")
 *   .build();
 * ```
 *
 * @packageDocumentation
 */

// ============================================================
//  1. HKT Core
// ============================================================

/** @internal Base interface for Higher-Kinded Types. */
interface HKT {
    readonly _ctx: unknown;
    readonly _output: unknown;
    readonly _deps: string;
    readonly _tag: unknown;
}

/** @internal Apply context `Ctx` to HKT `F`, producing its output type. */
type Apply<F extends HKT, Ctx> = (F & { readonly _ctx: Ctx })["_output"];

/** Flatten an intersection into a clean, readable object type. */
type Pretty<T> = { [K in keyof T]: T[K] } & {};

// ============================================================
//  2. Error Sentinel Types
// ============================================================

/**
 * Shown when `build()` is accessed before all schema fields are defined.
 * Hover over `_missing` to see which fields still need `defineX()` calls.
 *
 * @example
 * builder.build
 * //      ^^^^^ BuildNotReady<"workers" | "handlers">
 * //             _missing: "workers" | "handlers"
 */
interface BuildNotReady<Missing extends string> {
    readonly _error: "build() is not available — define all required fields first";
    readonly _missing: Missing;
}

// ============================================================
//  3. Building Blocks
// ============================================================

/**
 * Constant type — always resolves to `T`, regardless of context.
 * Has no dependencies.
 *
 * @typeParam T - The fixed type this block resolves to.
 *
 * @example
 * // Direct usage (advanced):
 * type Schema = { name: Const<string> };
 *
 * // Via ty DSL (preferred):
 * schema().field("name", ty.string)          // Const<string>
 * schema().field("config", ty.type<Cfg>())   // Const<Cfg>
 */
interface Const<T> extends HKT {
    readonly _deps: never;
    readonly _output: T;
}

/**
 * Reference to another field's resolved value. Creates a dependency on `K`.
 *
 * @typeParam K - Name of the field to reference.
 *
 * @example
 * type Schema = {
 *   name: Const<string>;
 *   copy: Pluck<"name">;  // copy = whatever value name was given
 * };
 *
 * // Via ty DSL:
 * .field("copy", $ => $.ref("name"))
 */
interface Pluck<K extends string> extends HKT {
    readonly _deps: K;
    readonly _output: this["_ctx"] extends Record<K, infer V> ? V : never;
}

/**
 * Record keyed by a dynamic string value from field `K`.
 * `ctx[K]` must be a string literal — it becomes the record key.
 *
 * @typeParam K - Field whose string value becomes the key.
 * @typeParam VH - HKT for the record's value type.
 * @deprecated Use `DictFrom<K, VH>` instead — it handles more source types.
 */
interface RecordFromKey<K extends string, VH extends HKT = Const<string>> extends HKT {
    readonly _deps: K | VH["_deps"];
    readonly _output: this["_ctx"] extends Record<K, infer Key extends string>
        ? { [P in Key]: Apply<VH, this["_ctx"]> }
        : never;
}

/**
 * Intersection of two HKT outputs: `Pretty<A & B>`.
 * Dependencies are the union of both operands.
 *
 * @example
 * .field("data", $ => $.merge(
 *   $.type<{ score: number }>(),
 *   $.dict($.from("game"), $.string),
 * ))
 * // { score: number } & { [game]: string }
 */
interface Merge<A extends HKT, B extends HKT> extends HKT {
    readonly _deps: A["_deps"] | B["_deps"];
    readonly _output: Pretty<Apply<A, this["_ctx"]> & Apply<B, this["_ctx"]>>;
}

/**
 * Readonly array of elements typed by HKT `E`.
 *
 * @example
 * .field("tags", ty.array(ty.string))
 * // defineTags(["typescript", "schema"])
 */
interface Arr<E extends HKT> extends HKT {
    readonly _tag: "Arr";
    readonly _deps: E["_deps"];
    readonly _output: readonly Apply<E, this["_ctx"]>[];
}

interface PromiseHKT<F extends HKT> extends HKT {
    readonly _deps: F["_deps"];
    readonly _output: Promise<Apply<F, this["_ctx"]>>;
}

/**
 * Nullable wrapper: `T | null`.
 *
 * @example
 * .field("bio", ty.nullable(ty.string))
 * // defineBio("hello")  or  defineBio(null)
 */
interface Nullable<F extends HKT> extends HKT {
    readonly _deps: F["_deps"];
    readonly _output: Apply<F, this["_ctx"]> | null;
}

/**
 * Union of two HKT outputs: `A | B`.
 *
 * @example
 * .field("role", ty.oneOf(ty.type<"admin">(), ty.type<"user">()))
 * // defineRole("admin")  or  defineRole("user")
 */
interface OneOf<A extends HKT, B extends HKT> extends HKT {
    readonly _deps: A["_deps"] | B["_deps"];
    readonly _output: Apply<A, this["_ctx"]> | Apply<B, this["_ctx"]>;
}

interface Self extends HKT {
    readonly _deps: never;
    readonly _output: this["_ctx"] extends { __self: infer S } ? S : never;
}

type ObjOutput<Shape extends Record<string, HKT>, Ctx> = {
    [K in keyof Shape & string]: Apply<Shape[K], Ctx & { __self: ObjOutput<Shape, Ctx> }>;
};

/**
 * Nested object with a fixed shape of HKT fields.
 * Dependencies are the union of all field dependencies.
 *
 * @example
 * .field("db", ty.object({
 *   host: ty.string,
 *   port: ty.number,
 * }))
 * // defineDb({ host: "localhost", port: 5432 })
 */
interface Obj<Shape extends Record<string, HKT>> extends HKT {
    readonly _tag: "Obj";
    readonly _deps: Shape[keyof Shape]["_deps"];
    readonly _output: Pretty<ObjOutput<Shape, this["_ctx"]>>;
}

/**
 * Extracts key identifiers from a context field value.
 * Auto-detects the source type:
 * - `string` → the literal string itself
 * - `string[]` → array elements
 * - `Record<K,V>` → `keyof`
 *
 * @internal Used by `DictFrom`, `KeySource`.
 */
interface KeysOf<K extends string> extends HKT {
    readonly _deps: K;
    readonly _output: this["_ctx"] extends Record<K, infer V>
        ? V extends string
            ? V
            : V extends readonly (infer El extends string)[]
                ? El
                : V extends Record<string, any>
                    ? keyof V & string
                    : never
        : never;
}

/**
 * Free-key dictionary: `Record<string, V>`.
 * Keys are determined at builder usage time (not constrained by schema).
 *
 * @example
 * .field("config", ty.dict(ty.string))
 * // defineConfig({ anyKey: "value", anotherKey: "..." })
 */
interface DynRecord<V extends HKT> extends HKT {
    readonly _tag: "DynRecord";
    readonly _deps: V["_deps"];
    readonly _output: Record<string, Apply<V, this["_ctx"]>>;
}

/**
 * Dictionary with keys derived from another field.
 * Auto-detects how to extract keys from the source:
 *
 * | Source type | Path | Keys |
 * |------------|------|------|
 * | `string` | `[]` | The string itself |
 * | `string[]` | `[]` | Array elements |
 * | `Record<K,V>` | `[]` | `keyof` |
 * | Any | `["field"]` | `source[*].field` values |
 * | Any | `["a","b"]` | Deep path `source[*].a.b` values |
 *
 * @typeParam K - Source field name.
 * @typeParam V - HKT for value type (uniform across all keys).
 * @typeParam Path - Optional deep path into the source structure.
 *
 * @example
 * // Keys from object:
 * $.dict($.from("features"), $.boolean)
 *
 * // Keys from string array:
 * $.dict($.from("roles"), $.type<boolean>())
 *
 * // Keys from deep path:
 * $.dict($.from("tasks", "name"), $.string)
 */
interface DictFrom<K extends string, V extends HKT, Path extends string[] = []> extends HKT {
    readonly _deps: K | V["_deps"];
    readonly _output: this["_ctx"] extends Record<K, infer Src>
        ? Path extends []
            ? Src extends readonly (infer El extends string)[]
                ? { [P in El]: Apply<V, this["_ctx"]> }
                : Src extends readonly (infer El)[]
                    ? El extends Record<string, any>
                        ? { [P in keyof El & string]: Apply<V, this["_ctx"]> }
                        : never
                    : Src extends Record<string, any>
                        ? { [P in keyof Src & string]: Apply<V, this["_ctx"]> }
                        : [Src] extends [string]
                            ? { [P in Src]: Apply<V, this["_ctx"]> }
                            : never
            : Src extends readonly (infer El)[]
                ? DeepGet<El, Path> extends infer FV extends string
                    ? { [P in FV]: Apply<V, this["_ctx"]> }
                    : never
                : Src extends Record<string, any>
                    ? [DeepGet<Src, Path>] extends [never]
                        ? Src extends Record<string, infer Entry>
                            ? DeepGet<Entry, Path> extends infer FV extends string
                                ? { [P in FV]: Apply<V, this["_ctx"]> }
                                : never
                            : never
                        : DeepGet<Src, Path> extends string
                            ? { [P in DeepGet<Src, Path> & string]: Apply<V, this["_ctx"]> }
                            : DeepGet<Src, Path> extends Record<string, any>
                                ? { [P in keyof DeepGet<Src, Path> & string]: Apply<V, this["_ctx"]> }
                                : never
                    : never
        : never;
}

/**
 * Function type: `(input: In) => Out`.
 * Both input and output types can depend on context.
 *
 * @example
 * // Static function type:
 * ty.fn(ty.type<Request>(), ty.type<Response>())
 *
 * // Per-entry projection (inside dict callback):
 * $$.fn($$("input"), $$("output"))
 */
interface Fn<In extends HKT, Out extends HKT> extends HKT {
    readonly _deps: In["_deps"] | Out["_deps"];
    readonly _output: (input: Apply<In, this["_ctx"]>) => Apply<Out, this["_ctx"]>;
}

/**
 * Access a field of the current dict entry inside a `DictMap` projection.
 * Automatically unwraps `TypeTag<H>` → `Apply<H, ctx>`.
 *
 * @typeParam Field - Name of the entry field to access.
 * @internal Used by `$$("field")` calls in dict callbacks.
 */
interface EntryProp<Field extends string> extends HKT {
    readonly _deps: never;
    readonly _output: this["_ctx"] extends { readonly __entry: infer E }
        ? E extends Record<Field, infer V>
            ? V extends TypeTag<infer H extends HKT> ? Apply<H, this["_ctx"]> : V
            : never
        : never;
}

/**
 * Type-level join: look up `entry[KeyField]` in `ctx[Source]` and resolve the type.
 *
 * Use inside `$$` callbacks when entry fields are **keys into another dict**
 * (a type catalog). Automatically unwraps `TypeTag<H>` → `Apply<H, ctx>`.
 *
 * @typeParam Source - Name of the dict field to look up in (e.g., `"types"`).
 * @typeParam KeyField - Name of the entry field whose value is used as the key (e.g., `"input"`).
 *
 * @example
 * schema()
 *   .field("types", ty.dict(ty.desc))
 *   .field("methods", $ => $.dict($.object({ input: $.from("types"), output: $.from("types") })))
 *   .field("handlers", $ => $.dict($.from("methods"), $$ =>
 *     $$.fn($$.lookup("types", "input"), $$.lookup("types", "output"))
 *   ))
 */
interface Lookup<Source extends string, KeyField extends string> extends HKT {
    readonly _deps: Source;
    readonly _output: this["_ctx"] extends { readonly __entry: infer E }
        ? E extends Record<KeyField, infer Key extends string>
            ? this["_ctx"] extends Record<Source, infer Dict extends Record<string, any>>
                ? Key extends keyof Dict
                    ? Dict[Key] extends TypeTag<infer H extends HKT> ? Apply<H, this["_ctx"]> : Dict[Key]
                    : never
                : never
            : never
        : never;
}

/**
 * Unwraps a `TypeTag<H>` to its resolved type.
 * @internal
 */
interface Desc<Source extends HKT> extends HKT {
    readonly _deps: Source["_deps"];
    readonly _output: Apply<Source, this["_ctx"]> extends TypeTag<infer H extends HKT>
        ? Apply<H, this["_ctx"]>
        : never;
}

/**
 * Per-key projection over a dictionary or array source.
 * Iterates over keys/indices and applies `Proj` to each entry,
 * injecting the current entry as `__entry` in the context.
 *
 * **Without path (`Path = []`):**
 * - Dict source → keys = `keyof`, entry = each value
 * - Array source → keys = `"0" | "1" | ...`, entry = each element
 *
 * **With deep path (`Path = ["a", "b"]`):**
 * - Keys = `DeepGet(entry, Path)` string values
 * - `$$` context = parent object of the key field
 *
 * @typeParam Source - Context field to iterate over.
 * @typeParam Proj - HKT applied per-key (receives `__entry`).
 * @typeParam Path - Optional deep path for key extraction.
 *
 * @example
 * // Per-key handlers:
 * $.dict($.from("tasks"), $$ =>
 *   $$.fn($$("input"), $$("output"))
 * )
 * // tasks = { resize: { input: ..., output: ... } }
 * // handlers = { resize: (input) => output }
 */
interface DictMap<Source extends string, Proj extends HKT, Path extends string[] = []> extends HKT {
    readonly _deps: Source | Proj["_deps"];
    readonly _output: this["_ctx"] extends Record<Source, infer Src>
        ? Path extends []
            ? Src extends readonly any[]
                ? { [P in Extract<keyof Src, `${number}`> & string]: Apply<Proj, this["_ctx"] & { readonly __entry: Src[P & keyof Src] }> }
                : Src extends Record<string, any>
                    ? { [P in keyof Src & string]: Apply<Proj, this["_ctx"] & { readonly __entry: Src[P] }> }
                    : never
            : Src extends readonly (infer El extends Record<string, any>)[]
                ? DeepGet<El, Path> extends infer FV extends string
                    ? { [P in FV]: Apply<Proj, this["_ctx"] & { readonly __entry: DeepGet<Extract<El, DeepMatch<Path, P>>, InitPath<Path>> }> }
                    : never
                : Src extends Record<string, any>
                    ? [DeepGet<Src, Path>] extends [never]
                        ? { [K2 in keyof Src & string as DeepGet<Src[K2], Path> extends infer FV extends string ? FV : never]:
                            Apply<Proj, this["_ctx"] & { readonly __entry: DeepGet<Src[K2], InitPath<Path>> }> }
                        : DeepGet<Src, Path> extends Record<string, any>
                            ? { [P in keyof DeepGet<Src, Path> & string]: Apply<Proj, this["_ctx"] & { readonly __entry: DeepGet<Src, Path>[P] }> }
                            : never
                    : never
        : never;
}

// ── Helper types ─────────────────────────────────────────────

/** @internal Unwraps container to element/value HKT; passes through plain shapes (incl. Schema). */
type DictValueHKT<H> =
    H extends DynRecord<infer V extends HKT> ? V
    : H extends Arr<infer E extends HKT> ? E
    : H extends Schema<infer S extends Record<string, HKT>> ? Schema<S>
    : H;

/** @internal Extracts field names from an Obj or Schema shape. */
type ObjFieldNames<H> =
    H extends Obj<infer Shape extends Record<string, HKT>>
        ? keyof Shape & string
        : H extends Schema<infer Shape extends Record<string, HKT>>
            ? keyof Shape & string
            : string;

/** @internal Field names available on a dict/array entry. */
type EntryFieldNames<H> = ObjFieldNames<DictValueHKT<H>>;

/** @internal Resolves a specific field's HKT from an Obj or Schema shape. */
type ObjFieldHKT<H, F extends string> =
    H extends Obj<infer Shape extends Record<string, HKT>>
        ? F extends keyof Shape ? Shape[F] : never
        : H extends Schema<infer Shape extends Record<string, HKT>>
            ? F extends keyof Shape ? Shape[F] : never
            : never;

/** @internal Recursively resolves an HKT through a nested path of Obj fields. */
type ResolveField<H, Path extends readonly string[]> =
    Path extends [infer F extends string, ...infer Rest extends string[]]
        ? ResolveField<ObjFieldHKT<H, F>, Rest>
        : H;

/** @internal Gets available field names at a specific path depth within a schema field. */
type FieldAt<S extends Record<string, HKT>, K extends string, Path extends string[]> =
    K extends "self"
        ? Path extends [] ? keyof S & string : ObjFieldNames<ResolveField<Schema<S>, Path>>
        : ObjFieldNames<ResolveField<DictValueHKT<S[K]>, Path>>;

/**
 * Deep field access by path tuple.
 * @example
 * type R = DeepGet<{ a: { b: { c: string } } }, ["a", "b", "c"]>; // string
 */
type DeepGet<T, Path extends readonly string[]> =
    Path extends [infer F extends string, ...infer Rest extends string[]]
        ? T extends readonly (infer E)[]
            ? DeepGet<E extends Record<F, infer V> ? V : never, Rest>
            : T extends Record<F, infer V> ? DeepGet<V, Rest> : never
        : T;

type UnwrapTypeTag<T, Ctx> = T extends TypeTag<infer H extends HKT> ? Apply<H, Ctx> : T;

export interface DeepPluck<K extends string, Path extends string[], S extends Record<string, HKT> = {}> extends HKT {
    readonly _deps: K extends "self" ? never : K;
    readonly _output: UnwrapTypeTag<
        K extends "self" 
            ? DeepGet<this["_ctx"] extends { __selfSchema: infer Self } ? Self : SelfResolve<S, {}>, Path>
            : DeepGet<this["_ctx"] extends Record<K, infer V> ? V : never, Path>,
        this["_ctx"]
    >;
}

interface DeepEntry<Path extends string[]> extends HKT {
    readonly _deps: never;
    readonly _output: this["_ctx"] extends { readonly __entry: infer E }
        ? DeepGet<E, Path> extends TypeTag<infer H extends HKT> ? Apply<H, this["_ctx"]> : DeepGet<E, Path>
        : never;
}

type RefTag<K extends string, S extends Record<string, HKT>, Path extends string[] = []> = TypeTag<DeepPluck<K, Path, S>> & {
    [P in (K extends "self" ? keyof S & string : FieldAt<S, K, Path>)]: RefTag<K, S, [...Path, P]>
};

type EntryHKT<S extends Record<string, HKT>, K extends string, Pa extends string[]> =
    ResolveField<DictValueHKT<S[K]>, Pa> extends DynRecord<infer V extends HKT>
        ? V
        : ResolveField<DictValueHKT<S[K]>, Pa> extends Arr<infer E extends HKT>
            ? E
            : DictValueHKT<ResolveField<DictValueHKT<S[K]>, InitPath<Pa>>>;

type EntryFieldAt<S extends Record<string, HKT>, K extends string, Pa extends string[], Path extends string[]> =
    ObjFieldNames<ResolveField<EntryHKT<S, K, Pa>, Path>>;

type EntryRefTag<S extends Record<string, HKT>, K extends string, Pa extends string[], Path extends string[] = []> = TypeTag<DeepEntry<Path>> & {
    [P in EntryFieldAt<S, K, Pa, Path>]: EntryRefTag<S, K, Pa, [...Path, P]>
};

interface RecordFromKeys<Keys extends HKT, V extends HKT> extends HKT {
    readonly _deps: Keys["_deps"] | V["_deps"];
    readonly _output: Apply<Keys, this["_ctx"]> extends string
        ? { [P in Apply<Keys, this["_ctx"]>]: Apply<V, this["_ctx"]> }
        : never;
}

interface ValuesOfTag<T extends HKT> extends HKT {
    readonly _deps: T["_deps"];
    readonly _output: Apply<T, this["_ctx"]> extends Record<string, infer V> ? V : never;
}

interface KeysOfTag<T extends HKT> extends HKT {
    readonly _deps: T["_deps"];
    readonly _output: Apply<T, this["_ctx"]> extends string
        ? Apply<T, this["_ctx"]>
        : Apply<T, this["_ctx"]> extends readonly (infer El extends string)[]
            ? El
            : Apply<T, this["_ctx"]> extends Record<string, any>
                ? keyof Apply<T, this["_ctx"]> & string
                : never;
}

interface AccessTag<T extends HKT, K extends HKT> extends HKT {
    readonly _deps: T["_deps"] | K["_deps"];
    readonly _output: Apply<K, this["_ctx"]> extends string
        ? Apply<T, this["_ctx"]> extends infer U
            ? U extends Record<Apply<K, this["_ctx"]>, infer V>
                ? V extends TypeTag<infer H extends HKT> ? Apply<H, this["_ctx"]> : V
                : never
            : never
        : never;
}

/** @internal Builds a nested pattern for `Extract`: `DeepMatch<["a","b"], V>` → `{ a: { b: V } }`. */
type DeepMatch<Path extends readonly string[], V> =
    Path extends [infer F extends string, ...infer Rest extends string[]]
        ? Record<F, DeepMatch<Rest, V>>
        : V;

/** @internal All path segments except the last: `InitPath<["a","b","c"]>` → `["a","b"]`. */
type InitPath<P extends readonly string[]> =
    P extends [...infer Init extends string[], string] ? Init : [];

/**
 * Nested schema — embeds a full schema as a single field.
 * Internal dependencies are resolved within the nested builder;
 * only truly external deps leak to the outer level.
 *
 * `BuilderFor<Schema<S>>` → `SmartBuilder<S>` (inner builder with dep tracking).
 *
 * @typeParam S - The inner schema's field definitions.
 *
 * @example
 * const Base = schema().field("events", ty.dict(...)).field("handlers", ...);
 * schema()
 *   .field("framework", Base)               // embeds as nested schema
 *   .field("loggers", $ => $.dict($.from("framework", "events"), ...))
 *   .done();
 */
interface Schema<S extends Record<string, HKT>> extends HKT {
    readonly _tag: "Schema";
    readonly _deps: ExternalDeps<S>;
    readonly _output: Pretty<SelfResolve<S, this["_ctx"]>>;
}

/** @internal Deps that can't be satisfied within the schema itself. */
type ExternalDeps<S extends Record<string, HKT>> =
    Exclude<S[keyof S]["_deps"] & string, keyof S & string>;

/** @internal Resolves a schema against itself + outer context (fixpoint). */
type SelfResolve<S extends Record<string, HKT>, Ctx = {}> = {
    [K in keyof S & string]: Apply<S[K], Ctx & SelfResolve<S, Ctx> & { __selfSchema: SelfResolve<S, Ctx> }>;
};

/**
 * Determines which fields `$$` exposes inside a dict projection callback.
 *
 * - If path reaches a `DynRecord<V>` → fields of V (the dict value shape)
 * - If path reaches an `Arr<E>` → fields of E (the array element shape)
 * - Otherwise → fields of the parent object (InitPath)
 *
 * @internal
 */
type EntryFields<S extends Record<string, HKT>, K extends string, Pa extends string[]> =
    ResolveField<DictValueHKT<S[K]>, Pa> extends DynRecord<infer V extends HKT>
        ? ObjFieldNames<V>
        : ResolveField<DictValueHKT<S[K]>, Pa> extends Arr<infer E extends HKT>
            ? ObjFieldNames<E>
            : ObjFieldNames<ResolveField<DictValueHKT<S[K]>, InitPath<Pa>>>;

// ============================================================
//  4. SmartBuilder — reactive dependency-aware builder
// ============================================================

/**
 * Reactive, dependency-aware builder type.
 *
 * - Only shows `defineX()` when field X's dependencies are already defined.
 * - `build()` is always visible: callable when ready, shows `BuildNotReady` otherwise.
 * - Definition order within a dependency level is free.
 *
 * @typeParam S - Schema: `Record<fieldName, HKT>`.
 * @typeParam Ctx - Already-defined fields (grows with each `defineX` call).
 */
type SmartBuilder<
    S extends Record<string, HKT>,
    Ctx extends Record<string, any> = {},
> = {
    [K in keyof S & string as K extends keyof Ctx
        ? never
        : S[K]["_deps"] extends keyof Ctx
            ? `define${Capitalize<K>}`
            : never]: <const V extends Apply<S[K], Ctx & { __selfSchema: SelfResolve<S, {}> }>>(
        valueOrFactory: (V & Apply<S[K], Ctx & { __selfSchema: SelfResolve<S, {}> }>) | ((b: BuilderFor<S[K], Ctx & { __selfSchemaBuilder: SmartBuilder<S>; __selfSchema: SelfResolve<S, {}> }>, ctx: Ctx) => V),
    ) => SmartBuilder<S, Pretty<Ctx & Record<K, V>>>;
} & {
    /**
     * Finalize and return the constructed object.
     *
     * If this shows `BuildNotReady<...>`, check `_missing` to see
     * which fields still need `defineX()` calls.
     */
    build: [Exclude<keyof S & string, keyof Ctx & string>] extends [never]
        ? () => Pretty<Ctx>
        : BuildNotReady<Exclude<keyof S & string, keyof Ctx & string>>;
};

// ============================================================
//  4a. Inner Builders (callback syntax for defineX)
// ============================================================

/**
 * Maps HKT → concrete inner builder for callback syntax in `defineX(b => ...)`.
 *
 * | HKT | Builder | API |
 * |-----|---------|-----|
 * | `Obj<Shape>` | `ObjStepBuilder` | `.defineX(v).build()` |
 * | `Arr<E>` | `ArrStepBuilder` | `.add(v).done()` |
 * | `DynRecord<V>` | `DictStepBuilder` | `.entry(k, v).done()` |
 */
type BuilderFor<H extends HKT, Ctx> =
    H extends { _tag: "Schema" } & Schema<infer S extends Record<string, HKT>>
        ? SmartBuilder<S>
        : H extends { _tag: "Obj" } & Obj<infer Shape extends Record<string, HKT>>
            ? ObjStepBuilder<Shape, Ctx>
            : H extends { _tag: "Arr" } & Arr<infer E extends HKT>
                ? ArrStepBuilder<E, Ctx>
                : H extends { _tag: "DynRecord" } & DynRecord<infer V extends HKT>
                    ? DictStepBuilder<V, Ctx>
                    : H extends Self
                        ? Ctx extends { __selfBuilder: infer B } ? B : never
                        : H extends DeepPluck<"self", [], any>
                            ? Ctx extends { __selfSchemaBuilder: infer B } ? B : never
                            : never;

/**
 * Step-builder for `Obj<Shape>`.
 * Define fields one by one with `.defineX(v)`, then finalize with `.build()`.
 */
type ObjStepBuilder<
    Shape extends Record<string, HKT>,
    Ctx,
    Built extends Record<string, any> = {},
> = {
    [K in keyof Shape & string as K extends keyof Built
        ? never
        : `define${Capitalize<K>}`]: <const V extends Apply<Shape[K], Ctx & { __self: ObjOutput<Shape, Ctx> }>>(
        v: (V & Apply<Shape[K], Ctx & { __self: ObjOutput<Shape, Ctx> }>) | ((b: BuilderFor<Shape[K], Ctx & { __selfBuilder: ObjStepBuilder<Shape, Ctx>; __self: ObjOutput<Shape, Ctx> }>, ctx: Ctx) => V),
    ) => ObjStepBuilder<Shape, Ctx, Pretty<Built & Record<K, V>>>;
} & {
    build: [Exclude<keyof Shape & string, keyof Built & string>] extends [never]
        ? () => Pretty<Built>
        : BuildNotReady<Exclude<keyof Shape & string, keyof Built & string>>;
};

/**
 * Step-builder for `Arr<E>`.
 * Append elements with `.add(v)`, finalize with `.done()`.
 */
type ArrStepBuilder<E extends HKT, Ctx> = {
    /** Append an element to the array. */
    add<const V extends Apply<E, Ctx & { __self: Ctx extends { __self: infer S } ? S : never }>>(
        v: (V & Apply<E, Ctx & { __self: Ctx extends { __self: infer S } ? S : never }>) | ((b: BuilderFor<E, Ctx & { __selfBuilder: Ctx extends { __selfBuilder: infer B } ? B : never }>, ctx: Ctx) => V),
    ): ArrStepBuilder<E, Ctx>;
    /** Finalize and return the readonly array. */
    done(): readonly Apply<E, Ctx>[];
};

/**
 * Step-builder for `DynRecord<V>`.
 * Add entries with `.entry(key, value)`, finalize with `.done()`.
 */
type DictStepBuilder<V extends HKT, Ctx, Built extends Record<string, any> = {}> = {
    /** Add a key-value entry to the dictionary. */
    entry<K extends string, const Val extends Apply<V, Ctx>>(
        key: K,
        v: (Val & Apply<V, Ctx>) | ((b: BuilderFor<V, Ctx>, ctx: Ctx) => Val),
    ): DictStepBuilder<V, Ctx, Pretty<Built & Record<K, Val>>>;
    /** Finalize and return the dictionary. */
    done(): Pretty<Built>;
};

// ============================================================
//  5. Factory Functions
// ============================================================

/**
 * Simple fluent builder from an interface — no dependencies.
 * All `defineX()` methods are always available; `build()` appears when all fields are set.
 */
type Builder<T, R = T> = {
    [K in keyof R as K extends string ? `define${Capitalize<K>}` : never]: (
        value: R[K],
    ) => Builder<T, Omit<R, K>>;
} & {
    build: [keyof R] extends [never]
        ? () => T
        : BuildNotReady<Extract<keyof R, string>>;
};

/**
 * Create a simple fluent builder from an interface.
 * No dependencies — fields can be defined in any order.
 *
 * @example
 * const user = MakeBuilder<{ name: string; age: number }>()
 *   .defineName("Alice")
 *   .defineAge(30)
 *   .build();
 * // { name: "Alice", age: 30 }
 */
function MakeBuilder<T extends Record<string, any>>(): Builder<T> {
    return createProxy() as Builder<T>;
}

/**
 * Create a dependency-aware builder from an HKT schema.
 * Fields with unsatisfied dependencies are hidden until their deps are defined.
 *
 * @example
 * import { type Const, type Merge, type DictFrom } from "defynets";
 *
 * type Schema = {
 *   name: Const<string>;
 *   data: Merge<Const<{ x: number }>, DictFrom<"name", Const<string>>>;
 * };
 *
 * const result = MakeDepBuilder<Schema>()
 *   .defineName("hello")       // defineData now available
 *   .defineData({ x: 1, hello: "world" })
 *   .build();
 */
function MakeDepBuilder<S extends Record<string, HKT>>(): SmartBuilder<S> {
    return createProxy() as SmartBuilder<S>;
}

// ============================================================
//  6. Schema Builder DSL
// ============================================================

/**
 * Phantom type tag carrying an HKT through the type system.
 * All `ty.*` methods return `TypeTag<H>`.
 * @internal Typically not used directly — use `ty.*` instead.
 */
interface TypeTag<H extends HKT> {
    readonly __phantom: H;
}

/**
 * Phantom tag for key/value source references.
 * Created by `$.from("ref", ...path)` inside schema callbacks.
 * Serves as both a field type and a dict key source.
 *
 * @typeParam K - Source field name.
 * @typeParam Path - Deep path segments into the source structure.
 */
interface KeySource<K extends string, Path extends string[] = []> {
    readonly __phantom: KeysOf<K>;
    readonly __keySource: K;
    readonly __keyPath: Path;
}

function tag<H extends HKT>(): TypeTag<H> {
    return null! as TypeTag<H>;
}

type Unwrap<T> = T extends TypeTag<infer H extends HKT> ? H : never;

// ── TyDSL — the public `ty` interface ───────────────────────

/**
 * Type definition DSL for describing schema field types.
 *
 * Use `ty.*` methods when defining fields directly (outside `$` callbacks).
 * Inside `schema().field("name", $ => ...)`, use `$.*` which provides
 * the same methods with context-aware autocomplete.
 *
 * @example
 * import { schema, ty } from "defynets";
 *
 * schema()
 *   .field("name", ty.string)
 *   .field("tags", ty.array(ty.string))
 *   .field("db", ty.object({ host: ty.string, port: ty.number }))
 *   .done();
 */
interface TyDSL {
    /**
     * String type.
     * @example
     * .field("name", ty.string)
     * // defineName expects: string
     */
    readonly string: TypeTag<Const<string>>;

    /**
     * Number type.
     * @example
     * .field("score", ty.number)
     * // defineScore expects: number
     */
    readonly number: TypeTag<Const<number>>;

    /**
     * Boolean type.
     * @example
     * .field("active", ty.boolean)
     * // defineActive expects: boolean
     */
    readonly boolean: TypeTag<Const<boolean>>;

    /**
     * Type descriptor slot — holds a `TypeTag` at runtime,
     * resolved when the builder user calls `defineX()`.
     *
     * Use in meta-schemas where consumers provide their own type definitions.
     *
     * @example
     * .field("tasks", ty.dict(ty.object({
     *   input: ty.desc,   // consumer passes ty.object({...}) here
     *   output: ty.desc,
     * })))
     */
    readonly desc: TypeTag<Const<TypeTag<any>>>;

    /**
     * Self reference for recursive object definitions.
     */
    self(): TypeTag<Self>;

    /**
     * Explicit TypeScript type. Use when primitives aren't specific enough.
     *
     * @example
     * ty.type<"light" | "dark">()         // string literal union
     * ty.type<{ custom: ComplexType }>()   // complex object
     * ty.type<(x: number) => string>()     // function
     */
    type<T>(): TypeTag<Const<T>>;

    /**
     * Reference another field's resolved value. Creates a dependency.
     *
     * @param key - Name of the field to reference.
     *
     * @example
     * schema()
     *   .field("name", ty.string)
     *   .field("copy", $ => $.ref("name"))
     *   // defineName("Alice") → defineCopy("Alice")  ✓
     *   // defineCopy("Bob")   ← type must match name's value
     */
    ref<K extends string>(key: K): TypeTag<Pluck<K>>;

    /**
     * Dictionary type.
     * @example
     * // Free keys:
     * ty.record(ty.string)   // Record<string, string>
     */
    record: {
        <V extends HKT>(valueShape: TypeTag<V>): TypeTag<DynRecord<V>>;
        <K extends HKT, V extends HKT>(keys: TypeTag<K>, valueShape: TypeTag<V>): TypeTag<RecordFromKeys<K, V>>;
    };

    /**
     * Map over a dictionary or array source.
     */
    map: <K extends string, Pa extends string[], P extends HKT, S extends Record<string, HKT>>(
        source: RefTag<K, S, Pa>,
        proj: (entry: EntryRefTag<S, K, Pa, []>) => TypeTag<P>
    ) => TypeTag<DictMap<K, P, Pa>>;

    keysOf: <T extends HKT>(tag: TypeTag<T>) => TypeTag<KeysOfTag<T>>;

    valuesOf: <T extends HKT>(tag: TypeTag<T>) => TypeTag<ValuesOfTag<T>>;

    access: <T extends HKT, K extends HKT>(tag: TypeTag<T>, key: TypeTag<K>) => TypeTag<AccessTag<T, K>>;

    /**
     * Function type: `(input: In) => Out`.
     *
     * @example
     * ty.fn(ty.type<Request>(), ty.type<Response>())
     *
     * // Inside dict projection:
     * $$.fn($$("input"), $$("output"))
     */
    fn<In extends HKT, Out extends HKT>(input: TypeTag<In>, output: TypeTag<Out>): TypeTag<Fn<In, Out>>;

    /**
     * Intersection: `Pretty<A & B>`.
     *
     * @example
     * $.merge($.type<{ score: number }>(), $.dict($.from("game"), $.string))
     */
    merge<A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>): TypeTag<Merge<A, B>>;

    /**
     * Union: `A | B`.
     *
     * @example
     * ty.oneOf(ty.type<"admin">(), ty.type<"user">())
     */
    oneOf<A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>): TypeTag<OneOf<A, B>>;

    /**
     * Readonly array of elements.
     *
     * @example
     * ty.array(ty.string)                            // readonly string[]
     * ty.array(ty.object({ name: ty.string }))       // readonly { name: string }[]
     */
    array<E extends HKT>(element: TypeTag<E>): TypeTag<Arr<E>>;

    /**
     * Promise wrapper: `Promise<T>`.
     */
    promise<F extends HKT>(inner: TypeTag<F>): TypeTag<PromiseHKT<F>>;

    /**
     * Nullable: `T | null`.
     *
     * @example
     * ty.nullable(ty.string)   // string | null
     */
    nullable<F extends HKT>(inner: TypeTag<F>): TypeTag<Nullable<F>>;

    /**
     * Nested object with a typed shape.
     *
     * @example
     * ty.object({
     *   host: ty.string,
     *   port: ty.number,
     *   ssl: ty.boolean,
     * })
     */
    object<S extends Record<string, TypeTag<any>>>(shape: S): TypeTag<Obj<{ [K in keyof S & string]: Unwrap<S[K]> }>>;
}

/** @see {@link TyDSL} for method documentation. */
const ty: TyDSL = {
    string: tag<Const<string>>(),
    number: tag<Const<number>>(),
    boolean: tag<Const<boolean>>(),
    desc: tag<Const<TypeTag<any>>>(),
    self: () => tag<Self>(),
    type: <T>() => tag<Const<T>>(),
    ref: <K extends string>(key: K) => tag<Pluck<K>>(),
    record: tag as any,
    map: tag as any,
    keysOf: tag as any,
    valuesOf: tag as any,
    access: tag as any,
    fn: <In extends HKT, Out extends HKT>(input: TypeTag<In>, output: TypeTag<Out>) =>
        tag<Fn<In, Out>>(),
    merge: <A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>) =>
        tag<Merge<A, B>>(),
    oneOf: <A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>) =>
        tag<OneOf<A, B>>(),
    array: <E extends HKT>(element: TypeTag<E>) => tag<Arr<E>>(),
    promise: <F extends HKT>(inner: TypeTag<F>) => tag<PromiseHKT<F>>(),
    nullable: <F extends HKT>(inner: TypeTag<F>) => tag<Nullable<F>>(),
    object: <S extends Record<string, TypeTag<any>>>(shape: S) =>
        tag<Obj<{ [K in keyof S & string]: Unwrap<S[K]> }>>(),
};

/**
 * Create a builder from a flat schema descriptor object.
 * For schemas without cross-field references, simpler than `schema()`.
 *
 * @example
 * const builder = defineSchema({
 *   name: ty.string,
 *   age: ty.number,
 * });
 * const result = builder.defineName("Alice").defineAge(30).build();
 */
function defineSchema<S extends Record<string, TypeTag<any>>>(
    _schema: S,
): SmartBuilder<{ [K in keyof S & string]: Unwrap<S[K]> }> {
    return createProxy() as any;
}

// ── EntryScopedTy ────────────────────────────────────────────

/**
 * Entry-scoped DSL for per-key projections inside `dict(from, $$ => ...)`.
 *
 * Call `$$("fieldName")` to access a field of the current dict entry.
 * The callable syntax avoids confusion with method names like `$$.fn()`.
 *
 * When using deep paths, `$$` gives access to the **parent object** of the key field.
 *
 * @typeParam Fields - Available field names from the current entry.
 *
 * @example
 * .field("handlers", $ => $.dict($.from("tasks"), $$ =>
 *   $$.fn($$("input"), $$("output"))
 *   //    ^^^^^^^^^^^ callable — access entry's "input" field
 * ))
 */
type EntryScopedTy<Fields extends string, Keys extends string = string> = {
    /** Access a field of the current dict entry. Auto-unwraps `TypeTag`. */
    <F extends Fields>(field: F): TypeTag<EntryProp<F>>;

    /**
     * Type-level join: resolve `entry[field]` as a key in another dict.
     *
     * Use when entry fields are **keys into a type catalog**.
     * Looks up `ctx[source][entry[field]]` and unwraps `TypeTag` → concrete type.
     *
     * @param source - Name of the outer dict field (the type catalog).
     * @param field - Name of the entry field whose value is the lookup key.
     *
     * @example
     * $$.lookup("types", "input")
     * // entry.input = "user" → ctx.types["user"] → { userName: string }
     */
    lookup: <Src extends Keys, F extends Fields>(source: Src, field: F) => TypeTag<Lookup<Src, F>>;

    /** Function type: `(input: In) => Out`. */
    fn: <In extends HKT, Out extends HKT>(input: TypeTag<In>, output: TypeTag<Out>) => TypeTag<Fn<In, Out>>;
    /** Explicit TypeScript type. */
    type: <T>() => TypeTag<Const<T>>;
    /** String type. */
    string: TypeTag<Const<string>>;
    /** Number type. */
    number: TypeTag<Const<number>>;
    /** Boolean type. */
    boolean: TypeTag<Const<boolean>>;
    /** Type descriptor slot. */
    desc: TypeTag<Const<TypeTag<any>>>;
    /** Self reference. */
    self: () => TypeTag<Self>;
    /** Nested object with a typed shape. */
    object: <Sh extends Record<string, TypeTag<any>>>(
        shape: Sh,
    ) => TypeTag<Obj<{ [P in keyof Sh & string]: Unwrap<Sh[P]> }>>;
    /** Array type. */
    array: <E extends HKT>(element: TypeTag<E>) => TypeTag<Arr<E>>;
    /** Promise wrapper. */
    promise: <F extends HKT>(inner: TypeTag<F>) => TypeTag<PromiseHKT<F>>;
    /** Nullable: `T | null`. */
    nullable: <NF extends HKT>(inner: TypeTag<NF>) => TypeTag<Nullable<NF>>;
    /** Intersection: `A & B`. */
    merge: <A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>) => TypeTag<Merge<A, B>>;
    /** Union: `A | B`. */
    oneOf: <A extends HKT, B extends HKT>(a: TypeTag<A>, b: TypeTag<B>) => TypeTag<OneOf<A, B>>;
};

// ── ScopedTy ─────────────────────────────────────────────────

/**
 * Context-aware type DSL available inside `schema().field("name", $ => ...)`.
 *
 * Provides the same methods as `ty`, but constrained to previously defined fields.
 * `$.ref("...")` and `$.from("...")` autocomplete only shows declared fields.
 *
 * @typeParam Keys - Union of previously defined field names.
 * @typeParam S - Full schema for deep path resolution in dict callbacks.
 */
interface ScopedTy<Keys extends string, S extends Record<string, HKT> = Record<string, HKT>> {
    /** Schema-level self reference. */
    self: () => RefTag<"self", S, []>;

    /**
     * Reference another field's value. Autocomplete shows only previously defined fields.
     * @param key - Field name to reference (constrained to `Keys`).
     */
    ref: <K extends Keys>(key: K) => RefTag<K, S, []>;
}

// ── schema() — step-builder with full autocomplete ───────────

/**
 * Schema definition builder.
 *
 * Chain `.field(name, type)` calls to define schema fields.
 * Inside callbacks, `$` provides context-aware autocomplete.
 *
 * @typeParam S - Accumulated schema (grows with each `.field()` call).
 *
 * @example
 * const App = schema()
 *   .field("name", ty.string)
 *   .field("greeting", $ => $.ref("name"))  // $ knows "name"
 *   .done();  // → SmartBuilder
 */
class SchemaDef<S extends Record<string, HKT> = {}> {
    /**
     * Add a field to the schema.
     *
     * @param _key - Unique field name. Becomes `defineX()` on the builder
     *               (e.g., `"userName"` → `defineUserName()`).
     * @param _type - Field type: either a `ty.*` value or a callback `$ => $.someType()`.
     *               In callbacks, `$` only suggests previously defined field names.
     *
     * @example
     * .field("name", ty.string)                          // direct type
     * .field("data", $ => $.dict($.from("name"), $.string))  // with context
     */
    /**
     * Add a field whose type is a nested schema.
     * The nested schema becomes an embedded `Schema<S2>` HKT.
     * Internal dependencies are resolved within the nested builder;
     * only truly external deps leak to the outer level.
     *
     * At build time, `defineX(b => ...)` opens an inner `SmartBuilder`
     * that enforces the nested schema's dependency order.
     *
     * @example
     * const Base = schema()
     *   .field("events", ty.dict(ty.object({ ... })))
     *   .field("handlers", $ => $.dict($.from("events"), ...));
     *
     * schema()
     *   .field("framework", Base)
     *   .field("loggers", $ => $.dict($.from("framework", "events"), ...))
     *   .done();
     */
    field<K extends string, S2 extends Record<string, HKT>>(
        _key: K,
        _type: SchemaDef<S2>,
    ): SchemaDef<S & Record<K, Schema<S2>>>;

    /**
     * Add a field to the schema.
     *
     * @param _key - Unique field name. Becomes `defineX()` on the builder
     *               (e.g., `"userName"` → `defineUserName()`).
     * @param _type - Field type: either a `ty.*` value or a callback `$ => $.someType()`.
     *               In callbacks, `$` only suggests previously defined field names.
     *
     * @example
     * .field("name", ty.string)                          // direct type
     * .field("data", $ => $.dict($.from("name"), $.string))  // with context
     */
    field<K extends string, H extends HKT>(
        _key: K,
        _type:
            | TypeTag<H>
            | (($: ScopedTy<Extract<keyof S, string>, S>) => TypeTag<H>),
    ): SchemaDef<S & Record<K, H>>;

    field(_key: string, _type: any): any {
        return this as any;
    }

    /**
     * Finalize the schema and return a `SmartBuilder`.
     * The builder enforces field dependency order automatically.
     */
    done(): SmartBuilder<S> {
        return createProxy() as any;
    }

}

/**
 * Start building a schema definition.
 *
 * @returns A `SchemaDef` with fluent `.field()` / `.done()` API.
 *
 * @example
 * const MyBuilder = schema()
 *   .field("name", ty.string)
 *   .field("tags", ty.array(ty.string))
 *   .done();
 *
 * const result = MyBuilder
 *   .defineName("hello")
 *   .defineTags(["a", "b"])
 *   .build();
 */
function schema(): SchemaDef {
    return new SchemaDef();
}

// ============================================================
//  7. Proxy factories (immutable, callback-aware)
// ============================================================

function resolve(v: unknown, data: Record<string, unknown>): unknown {
    return typeof v === "function" ? (v as Function)(createInnerBuilder(data), data) : v;
}

function createInnerBuilder(
    data: Record<string, unknown> = {},
    items: unknown[] = [],
): unknown {
    return new Proxy(
        {},
        {
            get(_, prop) {
                if (typeof prop !== "string") return undefined;
                if (prop.startsWith("define") && prop.length > 6) {
                    const key = prop.charAt(6).toLowerCase() + prop.slice(7);
                    return (v: unknown) =>
                        createInnerBuilder({ ...data, [key]: resolve(v, data) }, items);
                }
                if (prop === "add") {
                    return (v: unknown) =>
                        createInnerBuilder(data, [...items, resolve(v, data)]);
                }
                if (prop === "entry") {
                    return (key: string, v: unknown) =>
                        createInnerBuilder({ ...data, [key]: resolve(v, data) }, items);
                }
                if (prop === "build") return () => ({ ...data });
                if (prop === "done")
                    return () => (items.length > 0 ? [...items] : { ...data });
                return undefined;
            },
        },
    );
}

function createProxy(data: Record<string, unknown> = {}): unknown {
    return new Proxy(
        {},
        {
            get(_, prop) {
                if (typeof prop !== "string") return undefined;
                if (prop === "build") return () => ({ ...data });
                if (prop.startsWith("define") && prop.length > 6) {
                    const key = prop.charAt(6).toLowerCase() + prop.slice(7);
                    return (v: unknown) => createProxy({ ...data, [key]: resolve(v, data) });
                }
                return undefined;
            },
        },
    );
}

// ============================================================
//  8. Exports
// ============================================================

export {
    // Core
    type HKT,
    type Apply,
    type Pretty,
    // Building blocks
    type Const,
    type Pluck,
    type RecordFromKey,
    type Merge,
    type Arr,
    type Nullable,
    type OneOf,
    type Obj,
    type KeysOf,
    type DynRecord,
    type DictFrom,
    type Fn,
    type EntryProp,
    type Lookup,
    type Desc,
    type DictMap,
    // Nested schema composition
    type Schema,
    type ExternalDeps,
    type SelfResolve,
    type EntryFields,
    // Error types
    type BuildNotReady,
    // Builder types
    type SmartBuilder,
    type Builder,
    type BuilderFor,
    type ObjStepBuilder,
    type ArrStepBuilder,
    type DictStepBuilder,
    // Schema DSL types
    type TypeTag,
    type KeySource,
    type Unwrap,
    type ScopedTy,
    type EntryScopedTy,
    type EntryFieldNames,
    // Helper types
    type DictValueHKT,
    type ObjFieldNames,
    type ObjFieldHKT,
    type ResolveField,
    type FieldAt,
    type DeepGet,
    type DeepMatch,
    type InitPath,
    // Runtime
    MakeBuilder,
    MakeDepBuilder,
    defineSchema,
    schema,
    ty,
};
