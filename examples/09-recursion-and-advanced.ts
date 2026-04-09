/**
 * Example 9 — Advanced Patterns & Recursion
 *
 * Demonstrates how to create recursive structures (like trees)
 * and other advanced type-level gymnastics using the schema builder.
 */
import { schema, ty } from "../src";

// ============================================================
//  1. Recursive Tree Structure
// ============================================================
//
// We want to define a tree of nodes where each node can have
// children of the same node type.
// We can use `$.self()` to reference the entire schema,
// or `ty.self()` to reference the current object type!

const TreeSchema = schema()
    .field("nodeId", ty.string)
    // $.self() refers to the entire TreeSchema output!
    .field("children", $ => ty.array($.self()))
    .done();

const myTree = TreeSchema
    .defineNodeId("root")
    .defineChildren([
        {
            nodeId: "child-1",
            children: []
        },
        {
            nodeId: "child-2",
            children: [
                { nodeId: "grandchild-1", children: [] }
            ]
        }
    ])
    .build();

const myTreeMadeWithBuilder = TreeSchema
.defineNodeId('root')
.defineChildren(c => c
    .add(c => c
        .defineNodeId('child-1')
        .defineChildren([])
        .build()
    )
    .add(c => c
        .defineNodeId('child-2')
        .defineChildren(c => c
            .add(c => c
                .defineNodeId('grandchild-1')
                .defineChildren([])
                .build()
            )
            .done())
        .build()
    )
    .done()
)

console.log("Tree root ID:", myTree.nodeId);

// ============================================================
//  2. Recursive Object with ty.self()
// ============================================================
//
// If you only want a specific object to be recursive, you can
// use `ty.self()` inside `ty.object()`.
// Let's build a complex UI Component Tree where components can
// have props and named slots containing more components!

const UIComponentSchema = schema()
    .field("rootNode", ty.object({
        type: ty.string,
        props: ty.record(ty.oneOf(ty.string, ty.number)),
        // ty.self() refers to the object being defined right now!
        slots: ty.record(ty.array(ty.self()))
    }))
    .done();

const myUI = UIComponentSchema
    .defineRootNode({
        type: "Container",
        props: { direction: "column", padding: 16 },
        slots: {
            header: [
                {
                    type: "Text",
                    props: { content: "Hello World", size: 24 },
                    slots: {}
                }
            ],
            body: [
                {
                    type: "Button",
                    props: { label: "Click Me" },
                    slots: {
                        icon: [
                            { type: "Icon", props: { name: "arrow-right" }, slots: {} }
                        ]
                    }
                }
            ]
        }
    })
    .build();

console.log("UI Root:", myUI.rootNode.type);
console.log("First body component:", myUI.rootNode.slots.body[0].type);

// ============================================================
//  2. Self-Referencing Dictionary (Graph / State Machine)
// ============================================================
//
// A graph where nodes reference other nodes in the same dictionary.
// We define the node IDs first, then the nodes themselves can only
// reference those valid IDs.

const GraphSchema = schema()
    .field("nodeIds", ty.array(ty.string))
    .field("nodes", $ => ty.record(
        ty.keysOf($.ref("nodeIds")),
        ty.object({
            label: ty.string,
            // Edges must point to valid node IDs
            edges: ty.array(ty.keysOf($.ref("nodeIds")))
        })
    ))
    .done();

const myGraph = GraphSchema
    .defineNodeIds(["A", "B", "C", "D"])
    .defineNodes({
        A: { label: "Start", edges: ["B", "C"] },
        B: { label: "Middle 1", edges: ["D"] },
        C: { label: "Middle 2", edges: ["D"] },
        D: { label: "End", edges: ["A"] } // Cycle!
    })
    .build();

console.log("Graph nodes:", Object.keys(myGraph.nodes));

// ============================================================
//  3. Dynamic Form Builder with Conditional Types
// ============================================================

// Let's implement the Type Map pattern for the Form!
const TypedFormBuilder = schema()
    // The catalog of available types
    .field("typeMap", ty.record(ty.desc))
    // The form definition
    .field("fields", $ => ty.record(ty.keysOf($.ref("typeMap"))))
    // The actual values!
    .field("values", $ => ty.map($.ref("fields"), fieldType => 
        ty.access($.ref("typeMap"), fieldType)
    ))
    .done();

const myForm = TypedFormBuilder
    .defineTypeMap({
        string: ty.string,
        number: ty.number,
        boolean: ty.boolean,
    })
    .defineFields({
        username: "string",
        age: "number",
        isActive: "boolean",
    })
    .defineValues({
        username: "alice_wonder",
        age: 28,
        isActive: true,
        // Try adding `age: "28"` — TypeScript will catch it!
    })
    .build();

console.log("Form values:", myForm.values);
