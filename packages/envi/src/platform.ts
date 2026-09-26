// The platform services of Node and Bun: the services of `NodeServices` in `@effect/platform-node`.
// Envi builds them from `@effect/platform-node-shared`, because `@effect/platform-node` asks for
// `redis` as a peer, and npm installs every peer into the project of the user.
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import * as Layer from "effect/Layer";

export const layer = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(
    NodeFileSystem.layer,
    NodeCrypto.layer,
    NodePath.layer,
    NodeStdio.layer,
    NodeTerminal.layer,
  ),
);

export type Services = Layer.Success<typeof layer>;
