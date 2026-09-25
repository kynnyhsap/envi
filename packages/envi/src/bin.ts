#!/usr/bin/env node
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { fileURLToPath } from "node:url";

import { ExitCode, KeychainAvailable, main } from "./cli.ts";
import { Envi } from "./core/index.ts";
import { delegatedVariable, findLocalBin, runLocal } from "./delegate.ts";
import * as Signals from "./signals.ts";

// The entry point is the only place that reads the process: arguments, environment, platform.
// The marker of a delegated run stays out of a child of `run`. A nested `envi` in another
// project must find its own local installation.
const { [delegatedVariable]: _delegated, ...parentEnvironment } = process.env;

const MainLayer = Layer.mergeAll(
  NodeServices.layer,
  Signals.layer,
  Layer.succeed(Envi.ParentEnvironment, parentEnvironment),
  Layer.succeed(KeychainAvailable, process.platform === "darwin"),
);

const argv = process.argv.slice(2);

const runHere = Effect.gen(function* () {
  const exitCode = yield* Ref.make(0);

  yield* Effect.provideService(main(argv, Math.round(process.uptime() * 1000)), ExitCode, exitCode);

  return yield* Ref.get(exitCode);
});

const program = Effect.gen(function* () {
  const local =
    process.env[delegatedVariable] === undefined
      ? yield* findLocalBin(process.cwd(), fileURLToPath(import.meta.url))
      : Option.none<string>();

  const code = yield* Option.match(local, {
    onNone: () => runHere,
    onSome: (bin) => Effect.orDie(runLocal(process.execPath, bin, argv)),
  });

  yield* Effect.sync(() => {
    process.exitCode = code;
  });
});

program.pipe(Effect.provide(MainLayer), Signals.runMain);
