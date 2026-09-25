// Creates, checks, and deletes the fake 1Password vaults of the end-to-end tests.
//
//   ENVI_TEST_ONEPASSWORD_ACCOUNT=<account> bun fixture:onepassword status
//   ENVI_TEST_ONEPASSWORD_ACCOUNT=<account> bun fixture:onepassword setup
//   ENVI_TEST_ONEPASSWORD_ACCOUNT=<account> bun fixture:onepassword teardown
//
// With ENVI_TEST_ONEPASSWORD_TOKEN, the script uses that service account token and asks for no
// approval. The service account needs the permission to create vaults. Without the token, the
// script uses desktop authentication: the 1Password app asks for one approval per run.
// `setup` is idempotent. It creates what is missing and replaces an item that differs.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { Argument, Command } from "effect/unstable/cli";

import {
  accountVariable,
  type FixtureItem,
  type FixtureVault,
  fixtureMarker,
  fixtureVaults,
  tokenVariable,
} from "../e2e/fixture.ts";

class FixtureError extends Data.TaggedError("FixtureError")<{ readonly detail: string }> {
  override get message(): string {
    return `Envi fixture failed: ${this.detail}`;
  }
}

const Action = { Status: "status", Setup: "setup", Teardown: "teardown" } as const;

const sdk = Effect.tryPromise({
  try: () => import("@1password/sdk"),
  catch: () => new FixtureError({ detail: "The package @1password/sdk does not load." }),
});

/** Runs one SDK call. The error holds the step and the SDK message, which holds no secret. */
const call = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new FixtureError({ detail: `${step}: ${cause instanceof Error ? cause.message : "failed"}` }),
  });

const missingCredential = () =>
  new FixtureError({
    detail: `Set ${tokenVariable} to a service account token, or ${accountVariable} to the name of the 1Password account.`,
  });

const connect = Effect.gen(function* () {
  const token = yield* Effect.mapError(
    Config.option(Config.Redacted(tokenVariable)),
    missingCredential,
  );

  const { createClient, DesktopAuth } = yield* sdk;

  const auth = Option.isSome(token)
    ? Redacted.value(token.value)
    : new DesktopAuth(yield* Effect.mapError(Config.String(accountVariable), missingCredential));

  return yield* call("create the client", () =>
    createClient({ auth, integrationName: "envi-e2e-fixture", integrationVersion: "0.0.0" }),
  );
});

type Client = Effect.Success<typeof connect>;

type FieldSignature = readonly [section: string, title: string, concealed: boolean, value: string];

/** The fields of an item as comparable text: section, title, type, and value. */
const signatureOf = (fields: ReadonlyArray<FieldSignature>): string =>
  JSON.stringify(fields.toSorted((left, right) => left.join().localeCompare(right.join())));

const expectedSignature = (item: FixtureItem): string =>
  signatureOf(
    item.fields.map((field) => [field.section ?? "", field.title, field.concealed, field.value]),
  );

const createItem = (client: Client, vaultId: string, item: FixtureItem) =>
  Effect.gen(function* () {
    const { ItemCategory, ItemFieldType } = yield* sdk;
    const sections = [...new Set(item.fields.flatMap((field) => field.section ?? []))];

    yield* call(`create the item ${item.title}`, () =>
      client.items.create({
        category: ItemCategory.SecureNote,
        vaultId,
        title: item.title,
        notes: fixtureMarker,
        sections: sections.map((title) => ({ id: title, title })),
        fields: item.fields.map((field) => {
          const base = {
            id: field.section === undefined ? field.title : `${field.section}-${field.title}`,
            title: field.title,
            fieldType: field.concealed ? ItemFieldType.Concealed : ItemFieldType.Text,
            value: field.value,
          };

          return field.section === undefined ? base : { ...base, sectionId: field.section };
        }),
      }),
    );
  });

/** Reports each difference between the account and the manifest. With `repair`, it fixes them. */
const reconcile = (client: Client, repair: boolean) =>
  Effect.gen(function* () {
    const { ItemFieldType } = yield* sdk;
    const existing = yield* call("list the vaults", () => client.vaults.list());
    const differences: Array<string> = [];

    const reconcileItem = (vault: FixtureVault, vaultId: string, item: FixtureItem) =>
      Effect.gen(function* () {
        const items = yield* call(`list the items of ${vault.title}`, () =>
          client.items.list(vaultId),
        );

        const matches = items.filter((candidate) => candidate.title === item.title);

        const current = yield* Effect.forEach(matches, (match) =>
          call(`read the item ${item.title}`, () => client.items.get(vaultId, match.id)),
        );

        const isCurrent =
          current.length === 1 &&
          current.every((actual) => {
            const sectionTitles = new Map(
              actual.sections.map((section) => [section.id, section.title]),
            );

            const actualSignature = signatureOf(
              actual.fields.map((field) => [
                sectionTitles.get(field.sectionId ?? "") ?? "",
                field.title,
                field.fieldType === ItemFieldType.Concealed,
                field.value,
              ]),
            );

            return actualSignature === expectedSignature(item);
          });

        if (isCurrent) {
          return;
        }

        differences.push(`item ${vault.title}/${item.title} is missing or differs`);

        if (repair) {
          yield* Effect.forEach(matches, (match) =>
            call(`delete the item ${item.title}`, () => client.items.delete(vaultId, match.id)),
          );

          yield* createItem(client, vaultId, item);
        }
      });

    const reconcileVault = (vault: FixtureVault) =>
      Effect.gen(function* () {
        const found = existing.filter((candidate) => candidate.title === vault.title);

        if (found.length > 1) {
          return yield* new FixtureError({
            detail: `Several vaults have the title ${vault.title}. Delete the extra vaults by hand.`,
          });
        }

        const [overview] = found;

        if (overview !== undefined && overview.description !== fixtureMarker) {
          return yield* new FixtureError({
            detail: `The vault ${vault.title} exists, and the fixture script does not own it.`,
          });
        }

        if (overview === undefined) {
          differences.push(`vault ${vault.title} is missing`);

          if (!repair) {
            return yield* Effect.void;
          }
        }

        const vaultId =
          overview?.id ??
          (yield* call(`create the vault ${vault.title}`, () =>
            client.vaults.create({ title: vault.title, description: fixtureMarker }),
          )).id;

        return yield* Effect.forEach(vault.items, (item) => reconcileItem(vault, vaultId, item), {
          discard: true,
        });
      });

    yield* Effect.forEach(fixtureVaults, reconcileVault, { discard: true });

    return differences;
  });

const teardown = (client: Client) =>
  Effect.gen(function* () {
    const existing = yield* call("list the vaults", () => client.vaults.list());
    const titles = new Set(fixtureVaults.map((vault) => vault.title));

    // Both the title and the description must match. The script deletes no other vault.
    const owned = existing.filter(
      (vault) => titles.has(vault.title) && vault.description === fixtureMarker,
    );

    yield* Effect.forEach(owned, (vault) =>
      Effect.andThen(
        call(`delete the vault ${vault.title}`, () => client.vaults.delete(vault.id)),
        Console.log(`Deleted the vault ${vault.title}.`),
      ),
    );

    yield* Console.log(`Deleted ${owned.length} of ${titles.size} fixture vaults.`);
  });

const action = Argument.Literals("action", [Action.Status, Action.Setup, Action.Teardown]).pipe(
  Argument.withDescription("status checks, setup creates and repairs, teardown deletes."),
);

const command = Command.make("onepassword-fixture", { action }, (input) =>
  Effect.gen(function* () {
    const client = yield* connect;

    if (input.action === Action.Teardown) {
      return yield* teardown(client);
    }

    const differences = yield* reconcile(client, input.action === Action.Setup);

    yield* Effect.forEach(differences, (difference) => Console.log(`- ${difference}`));

    if (input.action === Action.Setup) {
      return yield* Console.log(`The fixture is ready. Repaired ${differences.length} parts.`);
    }

    return differences.length === 0
      ? yield* Console.log("The fixture is complete.")
      : yield* new FixtureError({ detail: "The fixture is incomplete. Run `setup`." });
  }),
);

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
