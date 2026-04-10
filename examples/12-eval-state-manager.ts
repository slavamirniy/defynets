/**
 * Example 12 — State Manager with $.eval()
 *
 * A typed state management kernel: define the state shape once,
 * and initialState / mutations / getters all resolve automatically.
 *
 * Key features demonstrated:
 *   1. $.eval("StateType")  — state shape flows to all dependent fields
 *   2. ty.record + ty.fn    — mutations and getters as typed function dicts
 *   3. Progressive unlock   — initialState/mutations/getters appear after StateType
 */
import { schema, ty } from "../src";

// ============================================================
//  Library Author: define the store schema
// ============================================================

const StoreBuilder = schema()
    // 1. Type slot: the shape of the state
    .field("StateType", ty.desc)

    // 2. Initial state must match the declared shape
    .field("initialState", $ => $.eval("StateType"))

    // 3. Mutations: (currentState) => partial update object
    .field("mutations", $ => ty.record(
        ty.fn($.eval("StateType"), ty.type<Record<string, any>>()),
    ))

    // 4. Getters: (currentState) => any derived value
    .field("getters", $ => ty.record(
        ty.fn($.eval("StateType"), ty.type<any>()),
    ))
    .done();

// ============================================================
//  App Developer: create a counter store
// ============================================================

const counterStore = StoreBuilder
    .defineStateType(ty.object({
        count: ty.number,
        user: ty.nullable(ty.string),
    }))
    // initialState must match { count: number, user: string | null }
    .defineInitialState({
        count: 0,
        user: null,
    })
    .defineMutations({
        // state is auto-typed: { count: number, user: string | null }
        increment: (state) => ({ count: state.count + 1 }),
        decrement: (state) => ({ count: state.count - 1 }),
        login:     (state) => ({ user: "Alice" }),
        logout:    (state) => ({ user: null }),
    })
    .defineGetters({
        // state is auto-typed: { count: number, user: string | null }
        isLoggedIn: (state) => state.user !== null,
        doubled:    (state) => state.count * 2,
        greeting:   (state) => state.user ? `Hello, ${state.user}` : "Guest",
    })
    .build();

console.log("Counter store:", {
    initial: counterStore.initialState,
    mutations: Object.keys(counterStore.mutations),
    getters: Object.keys(counterStore.getters),
});

// ============================================================
//  Another store: todo list
// ============================================================

interface TodoItem {
    id: number;
    text: string;
    done: boolean;
}

const todoStore = StoreBuilder
    .defineStateType(ty.object({
        items: ty.type<TodoItem[]>(),
        filter: ty.type<"all" | "active" | "done">(),
    }))
    .defineInitialState({
        items: [],
        filter: "all" as const,
    })
    .defineMutations({
        addTodo: (state) => ({
            items: [...state.items, { id: Date.now(), text: "New", done: false }],
        }),
        toggleAll: (state) => ({
            items: state.items.map(i => ({ ...i, done: !i.done })),
        }),
        setFilter: (_state) => ({ filter: "active" }),
    })
    .defineGetters({
        activeCount: (state) => state.items.filter(i => !i.done).length,
        filtered: (state) => {
            if (state.filter === "all") return state.items;
            return state.items.filter(i =>
                state.filter === "done" ? i.done : !i.done,
            );
        },
    })
    .build();

console.log("Todo store:", {
    initial: todoStore.initialState,
    mutations: Object.keys(todoStore.mutations),
    getters: Object.keys(todoStore.getters),
});
