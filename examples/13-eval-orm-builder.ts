/**
 * Example 13 — ORM Builder with $.eval() + ty.map + ty.merge
 *
 * The ORM framework defines a base model, per-table schemas,
 * and generates typed repository interfaces (add, get) automatically.
 * Each repository method receives the merged type: BaseModel & TableFields.
 *
 * Key features demonstrated:
 *   1. $.eval("BaseModel")              — base type flows into every table
 *   2. ty.map over a dict               — iterate tableSchemas per-key
 *   3. ty.merge($.eval(...), $$)        — intersect base model with each entry
 *   4. ty.object inside ty.map          — per-table repository interface
 *   5. ty.fn + ty.promise + ty.nullable — async CRUD signatures
 */
import { schema, ty } from "../src";

// ============================================================
//  ORM Framework Author: define the repository schema
// ============================================================

const ORMBuilder = schema()
    // 1. Base model shared by all tables (id, timestamps, etc.)
    .field("BaseModel", ty.desc)

    // 2. Per-table custom field definitions
    .field("tableSchemas", ty.record(ty.desc))

    // 3. Typed repositories: iterate tableSchemas, generate CRUD methods per table
    .field("repositories", $ => ty.map($.ref("tableSchemas"), $$ =>
        ty.object({
            add: ty.fn(
                ty.merge($.eval("BaseModel"), $$),
                ty.promise(ty.boolean),
            ),
            get: ty.fn(
                ty.string,
                ty.promise(ty.nullable(ty.merge($.eval("BaseModel"), $$))),
            ),
        }),
    ))
    .done();

// ============================================================
//  App Developer: configure the database
// ============================================================

const myDB = ORMBuilder
    .defineBaseModel(ty.object({
        id: ty.string,
        createdAt: ty.type<Date>(),
    }))

    .defineTableSchemas({
        users: ty.object({ email: ty.string, age: ty.number }),
        posts: ty.object({ title: ty.string, content: ty.string }),
    })

    .defineRepositories({
        users: {
            // user: { id: string, createdAt: Date, email: string, age: number }
            add: async (user) => {
                console.log(`INSERT INTO users (${user.id}, ${user.email})`);
                return true;
            },
            get: async (id) => {
                return { id, createdAt: new Date(), email: "test@test.com", age: 25 };
            },
        },
        posts: {
            // post: { id: string, createdAt: Date, title: string, content: string }
            add: async (post) => {
                console.log(`INSERT INTO posts (${post.id}, ${post.title})`);
                return true;
            },
            get: async (id) => {
                return { id, createdAt: new Date(), title: "Hello", content: "World" };
            },
        },
    })
    .build();

// ============================================================
//  Using the typed database
// ============================================================

async function demo() {
    // TS enforces the full merged type: base fields + table-specific fields
    await myDB.repositories.users.add({
        id: "123-uuid",
        createdAt: new Date(),
        email: "alice@example.com",
        age: 30,
    });

    const post = await myDB.repositories.posts.get("456");
    if (post) {
        console.log(post.title);     // TS knows: string
        console.log(post.createdAt); // TS knows: Date (from BaseModel)
    }
}

demo();

// ============================================================
//  Variation: soft-delete ORM with richer base model
// ============================================================

const SoftDeleteORM = ORMBuilder
    .defineBaseModel(ty.object({
        id: ty.number,
        createdAt: ty.type<Date>(),
        updatedAt: ty.type<Date>(),
        deletedAt: ty.nullable(ty.type<Date>()),
    }))
    .defineTableSchemas({
        products: ty.object({ name: ty.string, price: ty.number, sku: ty.string }),
        orders:   ty.object({ customerId: ty.number, total: ty.number, status: ty.type<"pending" | "shipped" | "delivered">() }),
    })
    .defineRepositories({
        products: {
            // product: { id: number, createdAt: Date, updatedAt: Date, deletedAt: Date | null, name: string, price: number, sku: string }
            add: async (product) => {
                console.log(`INSERT product ${product.sku}: $${product.price}`);
                return true;
            },
            get: async (id) => null,
        },
        orders: {
            add: async (order) => {
                console.log(`INSERT order for customer ${order.customerId}, total: $${order.total}`);
                return true;
            },
            get: async (id) => ({
                id: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
                customerId: 42,
                total: 99.99,
                status: "pending" as const,
            }),
        },
    })
    .build();

console.log("Repositories:", {
    myDB: Object.keys(myDB.repositories),
    softDelete: Object.keys(SoftDeleteORM.repositories),
});

// ============================================================
//  CMS-style: repositories + resolvers
// ============================================================

const CMSBuilder = schema()
    .field("BaseContent", ty.desc)
    .field("contentTypes", ty.record(ty.desc))
    .field("repositories", $ => ty.map($.ref("contentTypes"), $$ =>
        ty.object({
            create: ty.fn(
                ty.merge($.eval("BaseContent"), $$),
                ty.promise(ty.boolean),
            ),
            findBySlug: ty.fn(
                ty.string,
                ty.promise(ty.nullable(ty.merge($.eval("BaseContent"), $$))),
            ),
        }),
    ))
    .field("renderers", $ => ty.map($.ref("contentTypes"), $$ =>
        ty.fn(ty.merge($.eval("BaseContent"), $$), ty.string),
    ))
    .done();

const myCMS = CMSBuilder
    .defineBaseContent(ty.object({
        slug: ty.string,
        publishedAt: ty.nullable(ty.type<Date>()),
    }))
    .defineContentTypes({
        article: ty.object({ title: ty.string, body: ty.string }),
        page:    ty.object({ title: ty.string, template: ty.string }),
    })
    .defineRepositories({
        article: {
            create: async (a) => { console.log(`Create article: ${a.title}`); return true; },
            findBySlug: async (slug) => ({
                slug, publishedAt: new Date(), title: "Found", body: "Content",
            }),
        },
        page: {
            create: async (p) => { console.log(`Create page: ${p.title}`); return true; },
            findBySlug: async (slug) => ({
                slug, publishedAt: null, title: "About", template: "default",
            }),
        },
    })
    .defineRenderers({
        article: (content) => `Article: ${content.title} (${content.slug})`,
        page:    (content) => `Page: ${content.title} [${content.template}]`,
    })
    .build();

console.log("CMS:", {
    repos: Object.keys(myCMS.repositories),
    renderers: Object.keys(myCMS.renderers),
});

// --- Advanced Type-Inferencing DeclarativeORM Example ---
// This demonstrates how to build a type-safe ORM-like schema using inferable schema building blocks.
// The types of repositories and methods are inferred fully from the catalog definitions and connect properly end-to-end.

// Define the "DeclarativeORM" builder with rich static inference for all table schemas and repositories
const DeclarativeORM = schema()
    .field("TypeCatalog", ty.record(ty.desc))
    .field("TableSchemas", $ => ty.record(ty.keysOf($.ref('TypeCatalog'))))
    .field("TableMethods", $ => ty.map($.ref('TableSchemas'), $$ => ty.record(ty.object({
        in: ty.keysOf($.ref('TypeCatalog')),
        out: ty.keysOf($.ref('TypeCatalog')),
    }))))
    .field("Repositories", $ => ty.map($.ref('TableMethods'), methods =>
        ty.map(methods, method =>
            ty.fn(
                ty.access($.ref('TypeCatalog'), method.in),
                ty.promise(ty.access($.ref('TypeCatalog'), method.out))
            )
        )
    ))
    .done();

// Instantiate your ORM schema, all types below are fully inferred and will produce helpful TypeScript errors if the structure is violated.
const mySystem = DeclarativeORM
    .defineTypeCatalog({
        User: ty.object({
            id: ty.string,
            name: ty.string,
            email: ty.string,
        }),
        Post: ty.object({
            id: ty.string,
            title: ty.string,
            content: ty.string,
        }),
        Id: ty.string,
    })
    .defineTableSchemas({
        User: 'User',
        Post: 'Post'
    })
    .defineTableMethods({
        Post: {
            getPostById: {
                in: 'Id',
                out: 'Post'
            },
            createPost: {
                in: 'Post',
                out: 'Post'
            }
        },
        User: {
            getUserById: {
                in: 'Id',
                out: 'User'
            },
            createUser: {
                in: 'User',
                out: 'User'
            }
        }
    })
    .defineRepositories({
        Post: {
            // input/output types are inferred from "TableMethods" declaration above!
            async getPostById(id) {
                // id: string
                return { id, title: "Hello", content: "World" }; // returns Post
            },
            async createPost(post) {
                // post: { id: string; title: string; content: string }
                return post;
            }
        },
        User: {
            async getUserById(id) {
                return { id, name: "Alice", email: "alice@example.com" };
            },
            async createUser(user) {
                return user;
            }
        }
    })
    .build();

// All type relationships remain preserved
// For example, the following call is fully type-checked:
mySystem.Repositories.Post.createPost({
    id: '123',
    content: 'hello',
    title: 'world'
}); // Will fail at compile-time if you miss a field or use the wrong type!

/*
    ## Doc Example

    This pattern lets you define catalogs, schemas, and method definitions using the builder,
    and TypeScript will infer the precise input and output types for all repository methods.

    - Each repository is mapped to the corresponding methods pulled from your "TableMethods" shape.
    - Each method infers its arguments and return types from your schema/catatalog.
    - Compile-time errors if your repository implementation doesn't match your schema or types.

    This makes downstream usage as ergonomic and robust as possible:

    ```ts
    const created = await mySystem.Repositories.Post.createPost({
        id: "abc",
        title: "Post title",
        content: "Post contents"
    });

    // Error on wrong fields:
    mySystem.Repositories.User.getUserById(123);        // ❌ Argument of type 'number' is not assignable to 'string'
    ```

    This is one of the most powerful patterns for building type-safe ORMs and API servers in TypeScript.
*/