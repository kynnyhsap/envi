#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { run } from "./cli.ts";
import * as Greeter from "./Greeter.ts";

const MainLayer = Layer.mergeAll(NodeServices.layer, Greeter.layer);

run.pipe(Effect.provide(MainLayer), NodeRuntime.runMain);
