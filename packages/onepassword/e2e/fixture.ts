// The fake data of the end-to-end tests against real 1Password. Every value here is fake and
// public. The fixture script writes this data, and the tests expect exactly these values.
// The account name never appears here. It comes from `ENVI_TEST_ONEPASSWORD_ACCOUNT`.

/** The environment variable that holds the 1Password account name for the tests. */
export const accountVariable = "ENVI_TEST_ONEPASSWORD_ACCOUNT";

/**
 * The environment variable that holds a service account token for the tests. With a token, no
 * run asks for an approval in the 1Password app. The token wins over the account name.
 */
export const tokenVariable = "ENVI_TEST_ONEPASSWORD_TOKEN";

/**
 * The description of each fixture vault. The script deletes a vault only when its title and this
 * description both match, so it never deletes a vault that it does not own.
 */
export const fixtureMarker =
  "Fake data for the Envi end-to-end tests. The Envi fixture script owns this vault. Safe to delete.";

export interface FixtureField {
  readonly title: string;
  readonly value: string;
  /** A concealed field. A plain text field otherwise. */
  readonly concealed: boolean;
  /** The title of the section of the field. A field without a section otherwise. */
  readonly section?: string;
}

/** One Secure Note. Its fields are the keys. */
export interface FixtureItem {
  readonly title: string;
  readonly fields: ReadonlyArray<FixtureField>;
}

export interface FixtureVault {
  readonly title: string;
  readonly items: ReadonlyArray<FixtureItem>;
}

export const primaryVault = "envi-e2e-primary";

export const secondaryVault = "envi-e2e-secondary";

export const fixtureVaults: ReadonlyArray<FixtureVault> = [
  {
    title: primaryVault,
    items: [
      {
        title: "app",
        fields: [
          {
            title: "DATABASE_URL",
            value: "postgres://envi:fake-password@localhost:5432/envi_e2e",
            concealed: true,
          },
          { title: "PORT", value: "4100", concealed: false },
          { title: "API_TOKEN", value: "envi-e2e-fake-api-token", concealed: true },
          {
            title: "SENTRY_DSN",
            value: "https://fake-key@sentry.invalid/1",
            concealed: false,
            section: "web",
          },
        ],
      },
      {
        title: "multiline",
        fields: [
          {
            title: "PRIVATE_KEY",
            value:
              "-----BEGIN FAKE KEY-----\nenvi-e2e-line-one\nenvi-e2e-line-two\n-----END FAKE KEY-----",
            concealed: true,
          },
        ],
      },
    ],
  },
  {
    title: secondaryVault,
    items: [
      {
        title: "payments",
        fields: [{ title: "STRIPE_KEY", value: "sk_test_envi_e2e_fake", concealed: true }],
      },
    ],
  },
];
