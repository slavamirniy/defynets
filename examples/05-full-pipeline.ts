/**
 * Example 5 — Complete System: Image Processing Pipeline
 *
 * Combines ALL features into a realistic multi-level system.
 * Demonstrates how SmartBuilder enforces dependency phases automatically.
 *
 * Dependency graph:
 *   Level 1 (no deps):      taskTypes
 *   Level 2 (← taskTypes):  workers, storages, handlers
 *   Level 3 (← workers+):   pipeline
 *
 *   defineX() methods appear progressively as dependencies are satisfied.
 *   build() becomes callable only when ALL fields are defined.
 */
import { schema, ty } from "../src";

// ============================================================
//  Schema Definition
// ============================================================

const ImagePipeline = schema()

    // ── Level 1: Task types ─────────────────────────────────
    // Each task type declares its input and output shape.
    // ty.desc = type descriptor slot (consumer provides ty.object({...}))
    .field("taskTypes", ty.record(ty.object({
        input: ty.desc,
        output: ty.desc,
    })))

    // ── Level 2: Infrastructure ─────────────────────────────
    // Workers: each handles a subset of task types
    .field("workers", $ => ty.record(ty.object({
        handles: ty.array(ty.keysOf($.ref("taskTypes"))),
        concurrency: ty.type<number>(),
    })))

    // Storages: each can store outputs of certain task types
    .field("storages", $ => ty.record(ty.object({
        stores: ty.array(ty.keysOf($.ref("taskTypes"))),
        backend: ty.type<"s3" | "local" | "redis">(),
    })))

    // Handlers: per-task-type typed function (input → output)
    .field("handlers", $ => ty.map($.ref("taskTypes"), task =>
        ty.fn(task.input, task.output)
    ))

    // ── Level 3: Pipeline ───────────────────────────────────
    // Orchestration: each step references a task, worker, storage
    .field("pipeline", $ => ty.array(ty.object({
        task: ty.keysOf($.ref("taskTypes")),
        worker: ty.keysOf($.ref("workers")),
        storage: ty.keysOf($.ref("storages")),
    })))

    .done();

// ============================================================
//  Instance 1: Image Processing
// ============================================================
//
// After defineTaskTypes:
//   → defineWorkers, defineStorages, defineHandlers appear
// After defineWorkers + defineStorages:
//   → definePipeline appears
// After all:
//   → build() appears

const imageSystem = ImagePipeline
    // Level 1
    .defineTaskTypes({
        resize: {
            input: ty.object({ url: ty.string, width: ty.number, height: ty.number }),
            output: ty.object({ url: ty.string, dimensions: ty.string }),
        },
        thumbnail: {
            input: ty.object({ url: ty.string }),
            output: ty.object({ thumbUrl: ty.string, size: ty.number }),
        },
        watermark: {
            input: ty.object({ url: ty.string, text: ty.string }),
            output: ty.object({ url: ty.string }),
        },
    })

    // Level 2 — order within level is free
    .defineWorkers({
        imageWorker: {
            handles: ["resize", "thumbnail", "watermark"],
            concurrency: 4,
        },
        thumbWorker: {
            handles: ["thumbnail"],
            concurrency: 8,
        },
    })

    .defineStorages({
        s3: { stores: ["resize", "watermark"], backend: "s3" },
        cache: { stores: ["thumbnail"], backend: "redis" },
    })

    // Handlers — fully typed per task:
    //   resize:    (input: { url, width, height }) => { url, dimensions }
    //   thumbnail: (input: { url }) => { thumbUrl, size }
    //   watermark: (input: { url, text }) => { url }
    .defineHandlers({
        resize: (input) => ({
            url: `resized:${input.url}`,
            dimensions: `${input.width}x${input.height}`,
        }),
        thumbnail: (input) => ({
            thumbUrl: `thumb:${input.url}`,
            size: 128,
        }),
        watermark: (input) => ({
            url: `wm(${input.text}):${input.url}`,
        }),
    })

    // Level 3
    .definePipeline([
        { task: "resize", worker: "imageWorker", storage: "s3" },
        { task: "thumbnail", worker: "thumbWorker", storage: "cache" },
        { task: "watermark", worker: "imageWorker", storage: "s3" },
    ])

    .build();

console.log("Image Pipeline:", {
    tasks: Object.keys(imageSystem.taskTypes),
    workers: Object.keys(imageSystem.workers),
    steps: imageSystem.pipeline.length,
});


// ============================================================
//  Instance 2: Same schema, different configuration
// ============================================================
//
// The same ImagePipeline schema is reusable with different
// task types, workers, and orchestration.

const videoSystem = ImagePipeline
    .defineTaskTypes({
        transcode: {
            input: ty.object({ url: ty.string, codec: ty.string }),
            output: ty.object({ url: ty.string, format: ty.string }),
        },
        extractAudio: {
            input: ty.object({ url: ty.string }),
            output: ty.object({ audioUrl: ty.string }),
        },
    })
    .defineWorkers({
        ffmpegWorker: { handles: ["transcode", "extractAudio"], concurrency: 2 },
    })
    .defineStorages({
        localDisk: { stores: ["transcode", "extractAudio"], backend: "local" },
    })
    .defineHandlers({
        transcode: (input) => ({
            url: `transcoded:${input.url}`,
            format: input.codec,
        }),
        extractAudio: (input) => ({
            audioUrl: `audio:${input.url}`,
        }),
    })
    .definePipeline([
        { task: "transcode", worker: "ffmpegWorker", storage: "localDisk" },
        { task: "extractAudio", worker: "ffmpegWorker", storage: "localDisk" },
    ])
    .build();

console.log("Video Pipeline:", {
    tasks: Object.keys(videoSystem.taskTypes),
    workers: Object.keys(videoSystem.workers),
    steps: videoSystem.pipeline.length,
});
