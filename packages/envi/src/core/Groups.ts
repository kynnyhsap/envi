// The groups of `sync`. Envi resolves each group with one batch per provider, so configs that share
// a provider share its calls. Configs with different policies never share a group, so each config
// gets the cache and the stale fallback that a run of it alone gets.
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";

import type * as Config from "./Config.ts";
import type * as Provider from "./Provider.ts";
import type * as Resolver from "./Resolver.ts";
import type * as Source from "./Source.ts";

/** What one resolution applies to all its vars, after the precedence order of each setting. */
export interface Policy {
  /** `false` when a setting turns the cache off. */
  readonly cache: boolean;
  /** The stage, `refresh`, `strict`, `interactive`, `ttl`, and `maxStale`. */
  readonly settings: Resolver.Options;
}

/** One config of a sync, after the stage selection. */
export interface Member {
  readonly config: Config.Config;
  readonly stage: string;
  /** The policy of the config, as a run of the config alone selects it. */
  readonly policy: Policy;
  readonly providers: ReadonlyArray<Provider.Provider>;
  readonly vars: Readonly<Record<string, Source.AnySource>>;
}

/** The var key and the config file behind one key of a group. */
export interface Origin {
  readonly key: string;
  readonly config: Option.Option<string>;
}

export interface Group {
  /** The policy that every member shares. */
  readonly policy: Policy;
  readonly stage: string;
  readonly providers: ReadonlyArray<Provider.Provider>;
  /** The vars of every member. With more than one member, a key is `<index>:<var key>`. */
  readonly sources: Readonly<Record<string, Source.AnySource>>;
  readonly origins: Readonly<Record<string, Origin>>;
}

interface Draft {
  readonly policy: Policy;
  readonly stage: string;
  readonly providers: Map<string, Provider.Provider>;
  readonly sources: Record<string, Source.AnySource>;
  readonly origins: Record<string, Origin>;
}

/**
 * `true` when the member has the stage and the policy of the draft, and binds no provider id of
 * the draft to another instance.
 */
const fits = (draft: Draft, member: Member): boolean =>
  draft.stage === member.stage &&
  Equal.equals(draft.policy, member.policy) &&
  member.providers.every((provider) => (draft.providers.get(provider.id) ?? provider) === provider);

/**
 * Groups the members in order. Members share a group while they share the stage, the provider
 * instances, and the policy.
 */
export const of = (members: ReadonlyArray<Member>): ReadonlyArray<Group> => {
  const drafts: Array<Draft> = [];

  for (const [index, member] of members.entries()) {
    const found = drafts.find((draft) => fits(draft, member));

    const draft: Draft = found ?? {
      policy: member.policy,
      stage: member.stage,
      providers: new Map(),
      sources: {},
      origins: {},
    };

    if (found === undefined) {
      drafts.push(draft);
    }

    for (const provider of member.providers) {
      draft.providers.set(provider.id, provider);
    }

    for (const [key, source] of Object.entries(member.vars)) {
      const groupKey = members.length === 1 ? key : `${index}:${key}`;

      draft.sources[groupKey] = source;
      draft.origins[groupKey] = { key, config: member.config.path };
    }
  }

  return drafts.map((draft) => ({ ...draft, providers: [...draft.providers.values()] }));
};

/** The origin of one key of a group. */
export const originOf = (group: Group, groupKey: string): Origin =>
  group.origins[groupKey] ?? { key: groupKey, config: Option.none() };
