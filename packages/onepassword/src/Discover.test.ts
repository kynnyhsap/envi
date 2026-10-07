// The search of `envi find` through the 1Password provider. A fake SDK holds vaults, items, and
// field values. The search lists references and never returns a value.
import { describe, expect, it } from "@effect/vitest";
import { ProviderError, ProviderFailure } from "@kynnyhsap/envi";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";

import { makeProvider } from "./Provider.ts";
import type { Sdk } from "./Sdk.ts";

class FakeDesktopAuth {
  readonly accountName: string;

  constructor(accountName: string) {
    this.accountName = accountName;
  }
}

interface FakeField {
  readonly id: string;
  readonly title: string;
  readonly sectionId?: string;
  readonly value: string;
}

interface FakeItem {
  readonly id: string;
  readonly title: string;
  readonly sections: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly fields: ReadonlyArray<FakeField>;
}

interface FakeVault {
  readonly id: string;
  readonly title: string;
  readonly items: ReadonlyArray<FakeItem>;
}

const field = (title: string, sectionId?: string): FakeField => {
  const plain = { id: `${title}-id`, title, value: `fake-value-of-${title}` };

  return sectionId === undefined ? plain : { ...plain, sectionId };
};

const vaults: ReadonlyArray<FakeVault> = [
  {
    id: "app-id",
    title: "app",
    items: [
      {
        id: "postgres-id",
        title: "postgres",
        sections: [
          { id: "add more", title: "" },
          { id: "prod-id", title: "prod" },
        ],
        fields: [field("url", "add more"), field("password"), field("key", "prod-id")],
      },
      { id: "redis-id", title: "redis", sections: [], fields: [field("url")] },
    ],
  },
  {
    id: "payments-id",
    title: "payments",
    items: [
      {
        id: "stripe-id",
        title: "Stripe",
        sections: [],
        fields: [field("secret-key"), field("publishable-key")],
      },
      {
        id: "stripe-webhooks-id",
        title: "stripe-webhooks",
        sections: [],
        fields: [field("secret")],
      },
    ],
  },
];

/** The most items of one `items.getAll` call of the 1Password SDK. */
const sdkItemLimit = 50;

const allValues = vaults.flatMap((vault) =>
  vault.items.flatMap((item) => item.fields.map((entry) => entry.value)),
);

/** A faithful SDK over `data`. It records each call. `answer` replaces the answer of `getAll`. */
const fakeSdk = (data: ReadonlyArray<FakeVault>, answer?: (vaultId: string) => Schema.Json) => {
  const calls: Array<string> = [];
  const vaultOf = (id: string) => data.find((vault) => vault.id === id);

  const sdk: Sdk<FakeDesktopAuth> = {
    DesktopAuth: FakeDesktopAuth,
    AuthExpiredError: class extends Error {},
    DesktopSessionExpiredError: class extends Error {},
    RateLimitExceededError: class extends Error {},
    createClient: () =>
      Promise.resolve({
        secrets: { resolveAll: () => Promise.reject(new Error("find resolves no value")) },
        vaults: {
          list: () => {
            calls.push("vaults.list");

            return Promise.resolve(data.map(({ id, title }) => ({ id, title })));
          },
        },
        items: {
          list: (vaultId) => {
            calls.push(`items.list ${vaultId}`);

            return Promise.resolve(
              (vaultOf(vaultId)?.items ?? []).map(({ id, title }) => ({ id, title, vaultId })),
            );
          },
          getAll: (vaultId, itemIds) => {
            calls.push(`items.getAll ${vaultId} ${itemIds.join(",")}`);

            if (itemIds.length > sdkItemLimit) {
              return Promise.reject(new Error("too many items"));
            }

            return Promise.resolve(
              answer?.(vaultId) ?? {
                individualResponses: itemIds.map((itemId) => ({
                  content: {
                    ...vaultOf(vaultId)?.items.find((item) => item.id === itemId),
                    vaultId,
                  },
                  error: null,
                })),
              },
            );
          },
        },
      }),
  };

  return { sdk, calls };
};

const serviceAccount = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: "ops_fake" }),
);

const search = (
  sdk: Sdk<FakeDesktopAuth>,
  queries: ReadonlyArray<string>,
  options: { readonly account?: string; readonly interactive?: boolean } = {},
) => {
  const provider = makeProvider(
    options.account === undefined ? {} : { account: options.account },
    Effect.succeed(sdk),
  );

  return Option.match(provider.discover, {
    onNone: () => Effect.die("the 1Password provider can search"),
    onSome: (discover) => discover(queries, { interactive: options.interactive ?? true }),
  });
};

describe("the search of the 1Password provider", () => {
  it.effect("lists every field of each item whose title matches, and no value", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk(vaults);
      const results = yield* search(sdk, ["stripe", "postgress", "mysql"]);

      expect(results).toEqual({
        stripe: [
          "op://payments/Stripe/secret-key",
          "op://payments/Stripe/publishable-key",
          "op://payments/stripe-webhooks/secret",
        ],
        postgress: [
          "op://app/postgres/url",
          "op://app/postgres/password",
          "op://app/postgres/prod/key",
        ],
        mysql: [],
      });

      for (const value of allValues) {
        expect(JSON.stringify(results)).not.toContain(value);
      }
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("lists the vaults once, the items of each vault, and the fields of each match", () =>
    Effect.gen(function* () {
      const { sdk, calls } = fakeSdk(vaults);

      yield* search(sdk, ["stripe", "redis"]);

      expect(calls).toEqual([
        "vaults.list",
        "items.list app-id",
        "items.list payments-id",
        "items.getAll app-id redis-id",
        "items.getAll payments-id stripe-id,stripe-webhooks-id",
      ]);
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("puts the closest field of a reference query first", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk(vaults);
      const query = "op://app/postgres/passwrd";
      const results = yield* search(sdk, [query]);

      expect(results[query]?.[0]).toBe("op://app/postgres/password");
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("uses the ID of a name that a reference cannot hold or that is not unique", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk([
        {
          id: "shared-id",
          title: "team/shared",
          items: [
            {
              id: "api-1",
              title: "api",
              sections: [{ id: "s-id", title: "a?b" }],
              fields: [field("token", "s-id"), { ...field("token"), id: "token-2" }],
            },
            { id: "api-2", title: "api", sections: [], fields: [field("url")] },
          ],
        },
      ]);

      expect(yield* search(sdk, ["api"])).toEqual({
        api: [
          "op://shared-id/api-1/s-id/token-id",
          "op://shared-id/api-1/token-2",
          "op://shared-id/api-2/url",
        ],
      });
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect(
    "fails with InvalidResponse and keeps a value of a malformed answer out of the error",
    () =>
      Effect.gen(function* () {
        const sentinel = "fake-secret-sentinel";

        const { sdk } = fakeSdk(vaults, () => ({
          individualResponses: [{ content: { id: "redis-id", title: "redis", fields: sentinel } }],
        }));

        const error = yield* Effect.flip(search(sdk, ["redis"]));

        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ reason: ProviderFailure.InvalidResponse });
        expect(JSON.stringify(error) + String(error)).not.toContain(sentinel);
        expect(yield* search(fakeSdk(vaults).sdk, ["redis"])).toEqual({
          redis: ["op://app/redis/url"],
        });
      }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("reads the fields of more matches than one SDK call takes", () =>
    Effect.gen(function* () {
      const groups = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
      const perGroup = 10;

      const { sdk } = fakeSdk([
        {
          id: "many-id",
          title: "many",
          items: groups.flatMap((group) =>
            Array.from({ length: perGroup }, (_, index) => ({
              id: `${group}-${index}-id`,
              title: `${group}-${index}`,
              sections: [],
              fields: [field("token")],
            })),
          ),
        },
      ]);

      const results = yield* search(sdk, groups);

      for (const group of groups) {
        expect(results[group]).toHaveLength(perGroup);
      }
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("fails when 1Password cannot read a matched item, or leaves out an answer", () =>
    Effect.gen(function* () {
      const sentinel = "fake-internal-sentinel";

      const internal = yield* Effect.flip(
        search(
          fakeSdk(vaults, () => ({
            individualResponses: [{ error: { type: "internal", message: sentinel } }],
          })).sdk,
          ["redis"],
        ),
      );

      const missing = yield* Effect.flip(
        search(fakeSdk(vaults, () => ({ individualResponses: [] })).sdk, ["redis"]),
      );

      expect(internal).toMatchObject({ reason: ProviderFailure.Unavailable });
      expect(JSON.stringify(internal) + String(internal)).not.toContain(sentinel);
      expect(missing).toMatchObject({ reason: ProviderFailure.InvalidResponse });
      expect(yield* search(fakeSdk(vaults).sdk, ["redis"])).toEqual({
        redis: ["op://app/redis/url"],
      });
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("leaves out an item that 1Password deleted after the listing", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk(vaults, () => ({
        individualResponses: [{ error: { type: "itemNotFound" } }],
      }));

      expect(yield* search(sdk, ["redis"])).toEqual({ redis: [] });
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("matches no title with a query of other characters, such as an emoji", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk(vaults);
      const query = "\u{1F984}";

      expect(yield* search(sdk, [query])).toEqual({ [query]: [] });
    }).pipe(Effect.provide(serviceAccount)),
  );

  it.effect("needs an account and a prompt for the desktop app", () =>
    Effect.gen(function* () {
      const { sdk, calls } = fakeSdk(vaults);

      const withoutPrompt = yield* Effect.flip(
        search(sdk, ["redis"], { account: "my-team", interactive: false }),
      );

      const withoutAccount = yield* Effect.flip(search(sdk, ["redis"]));

      expect(withoutPrompt).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
      expect(withoutAccount).toMatchObject({ reason: ProviderFailure.Misconfigured });
      expect(calls).toEqual([]);

      expect(yield* search(sdk, ["redis"], { account: "my-team" })).toEqual({
        redis: ["op://app/redis/url"],
      });
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
  );
});
