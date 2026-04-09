/**
 * Example 8 — FSM, Pipeline, and Worker Queue
 *
 * Demonstrates complex schema definitions using the new API
 * (ref, map, record, keysOf, access).
 */
import { schema, ty } from "../src";

// ============================================================
//  1. Finite State Machine (FSM)
// ============================================================

export const Machine = schema()
  // 1. Describe states and their transitions
  .field("states", ty.record(ty.object({
    on: ty.record(ty.string), // Event -> NextState
    data: ty.desc           // Data stored in this state
  })))

  // 2. Describe transitions
  // We want a typed method transition(state, event) -> nextState
  .field("logic", $ => ty.map($.ref("states"), state => ty.object({
    // For each state, allow only events defined in it
    send: ty.fn(
      ty.keysOf(state.on), 
      ty.type<void>()
    ),
    // Automatic mapping of state data to the handler
    render: ty.fn(state.data, ty.string)
  })))
  .done();

export const trafficLight = Machine
  .defineStates({
    red: {
      on: { TIMER: "green" },
      data: ty.object({ carsWaiting: ty.number })
    },
    green: {
      on: { TIMER: "yellow" },
      data: ty.object({ carsPassed: ty.number })
    },
    yellow: {
      on: { TIMER: "red" },
      data: ty.type<null>()
    }
  })
  .defineLogic({
    red: {
      send: (event) => {
        // event is strictly "TIMER"
        console.log("Switching to green...");
      },
      render: (data) => `Red light. ${data.carsWaiting} cars waiting.`
    },
    green: {
      send: (event) => {
        console.log("Switching to yellow...");
      },
      render: (data) => `Green light. ${data.carsPassed} cars passed.`
    },
    yellow: {
      send: (event) => {
        console.log("Switching to red...");
      },
      render: () => `Yellow light. Slow down.`
    }
  })
  .build();

console.log(trafficLight.logic.red.render({ carsWaiting: 5 }));

// ============================================================
//  2. Pipeline
// ============================================================

export const Pipeline = schema()
  .field("registry", ty.record(ty.desc)) // All data types in the system
  
  .field("steps", $ => ty.array(ty.object({
    from: ty.keysOf($.ref("registry")),
    to:   ty.keysOf($.ref("registry")),
  })))

  // Consistency check: handlers must match steps
  .field("handlers", $ => ty.map($.ref("steps"), step => 
    ty.fn(
      ty.access($.ref("registry"), step.from),
      ty.access($.ref("registry"), step.to)
    )
  ))
  .done();

export const dataPipeline = Pipeline
  .defineRegistry({
    rawText: ty.string,
    tokens: ty.array(ty.string),
    wordCount: ty.number
  })
  .defineSteps([
    { from: "rawText", to: "tokens" },
    { from: "tokens", to: "wordCount" }
  ])
  .defineHandlers([
    (text) => text.split(" "), // rawText -> tokens
    (tokens) => tokens.length  // tokens -> wordCount
  ])
  .build();

console.log("Pipeline handlers:", dataPipeline.handlers.length);

// ============================================================
//  3. Worker Queue (Task System)
// ============================================================

const Contracts = schema()
  .field("tasks", ty.record(ty.object({
    input: ty.desc,
    output: ty.desc,
  })));

const Worker = schema()
  .field("contracts", Contracts) 
  .field("executors", $ => ty.map($.ref("contracts").tasks, task => 
    ty.fn(task.input, ty.promise(task.output))
  ));

const Orchestrator = schema()
  .field("contracts", Contracts)
  .field("flows", $ => ty.record(ty.array(ty.object({
    taskName: ty.keysOf($.ref("contracts").tasks),
    retryPolicy: ty.object({ maxAttempts: ty.number }),
  }))));

const TaskSystemDef = schema()
  .field("worker", Worker)
  .field("orchestrator", Orchestrator)
  .done();

export const system = TaskSystemDef
  .defineWorker(w => w
    .defineContracts({
      tasks: {
        fetchUser: { 
          input: ty.object({ id: ty.number }), 
          output: ty.object({ name: ty.string, email: ty.string }) 
        },
        sendEmail: { 
          input: ty.object({ email: ty.string, body: ty.string }), 
          output: ty.object({ success: ty.boolean }) 
        }
      }
    })
    .defineExecutors({
      fetchUser: async (input) => {
        return { name: "Alice", email: "alice@example.com" };
      },
      sendEmail: async (input) => {
        console.log(`Sending to ${input.email}`);
        return { success: true };
      }
    })
    .build()
  )
  .defineOrchestrator((o, ctx) => o
    .defineContracts(ctx.worker.contracts) 
    .defineFlows(b => b.entry("userOnboarding", [
        { taskName: "fetchUser", retryPolicy: { maxAttempts: 3 } },
        { taskName: "sendEmail", retryPolicy: { maxAttempts: 1 } }
    ]).done())
    .build()
  )
  .build();

console.log("System initialized with flows:", Object.keys(system.orchestrator.flows).filter(k => k !== 'worker' && k !== 'contracts'));
