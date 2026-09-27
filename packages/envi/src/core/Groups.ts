// The groups of `sync`. Envi resolves each group with one batch per provider, so configs that share
// a provider share its calls.
import * as Option from "effect/Option";

import type * as Config from "./Config.ts";
import type * as Provider from "./Provider.ts";
import type * as Source from "./Source.ts";

/** One config of a sync, after the stage selection. */
export interface Member {
  readonly config: Config.Config;
  readonly stage: string;
  readonly providers: ReadonlyArray<Provider.Provider>;
  readonly vars: Readonly<Record<string, Source.AnySource>>;
}

/** The var key and the config file behind one key of a group. */
export interface Origin {
  readonly key: string;
  readonly config: Option.Option<string>;
}

export interface Group {
  /** The config of the first member. Its cache settings apply to the group. */
  readonly config: Config.Config;
  readonly stage: string;
  readonly providers: ReadonlyArray<Provider.Provider>;
  /** The vars of every member. With more than one member, a key is `<index>:<var key>`. */
  readonly sources: Readonly<Record<string, Source.AnySource>>;
  readonly origins: Readonly<Record<string, Origin>>;
}

interface Draft {
  readonly config: Config.Config;
  readonly stage: string;
  readonly providers: Map<string, Provider.Provider>;
  readonly sources: Record<string, Source.AnySource>;
  readonly origins: Record<string, Origin>;
}

/** `true` when the member binds no provider id of the draft to another instance. */
const fits = (draft: Draft, member: Member): boolean =>
  draft.stage === member.stage &&
  member.providers.every((provider) => (draft.providers.get(provider.id) ?? provider) === provider);

/** Groups the members in order. Members share a group while they share the stage and the providers. */
export const of = (members: ReadonlyArray<Member>): ReadonlyArray<Group> => {
  const drafts: Array<Draft> = [];

  for (const [index, member] of members.entries()) {
    const found = drafts.find((draft) => fits(draft, member));

    const draft: Draft = found ?? {
      config: member.config,
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
