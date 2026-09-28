// Shared parts of the unit tests: the environment of a test, the Node platform, Envi on the
// in-memory cache, a cache record, and a finished child process.
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as Cache from "../Cache.ts";
import * as Envi from "../Envi.ts";

/** Runs an effect with `env` as the only environment variables that `Config` reads. */
export const withEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)));

/** The real file system and paths of Node. */
export const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** Envi on the in-memory cache. */
export const enviLayer = (options?: Envi.LayerOptions) =>
  Layer.provide(Envi.layer(options), Cache.layerMemory);

/** A cache record of the in-memory provider with a value. */
export const cacheRecord = (value: string, resolvedAt = 1000): Cache.CacheRecord => ({
  provider: "memory",
  reference: "memory://token",
  value: Option.some(Redacted.make(value)),
  resolvedAt,
});

/** A child process that already exited with `exitCode` and printed `stdout`. */
export const exitedProcess = (exitCode: number, stdout = "") =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.encodeText(Stream.make(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
