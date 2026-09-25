# The Linux test images. `bun run test:linux` builds and runs each target.
# - linux-secret-service: GNOME Keyring holds the cache key, as on a Linux desktop.
# - linux-bare: no keychain, as on a CI runner. The cache is off unless ENVI_CACHE_KEY is set.
FROM oven/bun:1.4.2-debian AS base

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /envi

COPY package.json bun.lock ./
COPY packages/envi/package.json packages/envi/
COPY packages/onepassword/package.json packages/onepassword/

RUN bun install --frozen-lockfile

COPY . .

FROM base AS linux-bare

ENV ENVI_E2E_NO_KEYCHAIN=1

CMD ["sh", "-c", "bun run --parallel test:unit test:e2e"]

FROM base AS linux-secret-service

RUN apt-get update \
  && apt-get install -y --no-install-recommends dbus gnome-keyring libsecret-tools \
  && rm -rf /var/lib/apt/lists/*

ENV ENVI_E2E_SECRET_SERVICE=1

# A D-Bus session with an unlocked keyring, as after a desktop login. The password is empty.
CMD ["dbus-run-session", "--", "sh", "-c", "printf '\\n' | gnome-keyring-daemon --unlock --components=secrets > /dev/null && bun run --parallel test:unit test:e2e"]
