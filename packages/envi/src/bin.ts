#!/usr/bin/env node
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { ExitCode, KeyStore, main } from "./cli.ts";
import * as Doctor from "./core/Doctor.ts";
import * as Envi from "./core/Envi.ts";
import { RuntimeName } from "./core/Reports.ts";
import { delegatedVariable, findLocalBin, runLocal } from "./delegate.ts";
import { keyStoreOf } from "./layer.ts";
import * as Platform from "./platform.ts";
import * as Signals from "./signals.ts";

// The entry point is the only place that reads the process: arguments, environment, platform.
// The marker of a delegated run stays out of a child of `run`. A nested `envi` in another
// project must find its own local installation.
const { [delegatedVariable]: _delegated, ...parentEnvironment } = process.env;

const keyStore = keyStoreOf(process.platform);

const bunVersion = process.versions["bun"];

const MainLayer = Layer.mergeAll(
  Platform.layer,
  Signals.layer,
  Layer.succeed(Envi.ParentEnvironment, parentEnvironment),
  Layer.succeed(KeyStore, keyStore),
  Layer.succeed(Doctor.System, {
    runtime: bunVersion === undefined ? RuntimeName.Node : RuntimeName.Bun,
    runtimeVersion: bunVersion ?? process.versions.node,
    platform: process.platform,
    arch: process.arch,
    keychain: keyStore,
  }),
);

// The arguments after the runtime and the script.
const [, , ...argv] = process.argv;

const runHere = Effect.gen(function* () {
  const exitCode = yield* Ref.make(0);

  yield* Effect.provideService(
    main(argv, Math.round(Duration.toMillis(Duration.seconds(process.uptime())))),
    ExitCode,
    exitCode,
  );

  return yield* Ref.get(exitCode);
});

const program = Effect.gen(function* () {
  const local =
    process.env[delegatedVariable] === undefined
      ? yield* findLocalBin(process.cwd(), import.meta.filename)
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
