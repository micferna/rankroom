# RankRoom, as one image: the app and the API behind a single origin.
#
# Serving both from one process is a security decision before it is a packaging
# one. A request from the page to the API is same-origin by construction, so the
# session cookie keeps `SameSite=Lax`, there is no CORS to misconfigure, and
# cross-site request forgery is not in the threat model. Two hosts would force
# `SameSite=None` and put that surface back.
#
# It also collapses the attack surface. The final image is distroless: no shell,
# no package manager, and no separate static-file server carrying its own
# release cadence and its own advisories. One binary and the files it serves.
#
# Every base below is pinned by digest, not by tag. A tag is a moving pointer:
# the image it names today is not the one it named last week, and a compromised
# — or simply different — base is the quietest way for something unwanted to
# enter a build. Dependabot raises a pull request when these move.

# --- the app ----------------------------------------------------------------

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS web

WORKDIR /build

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./

# `--ignore-scripts` is the point, not an optimisation. An npm package's install
# scripts run arbitrary code on whatever machine installs it, and that is the
# mechanism behind most published npm compromises. The build is verified to work
# without them, so nothing here grants it.
RUN npm ci --ignore-scripts

# Named rather than `COPY . .`, so a new file at the repository root cannot
# wander into the build without someone deciding it should.
# Every tsconfig, including the e2e one: Vite reads the root config and resolves
# its project references, so a referenced file that is absent fails the build
# even though nothing in it is compiled here.
COPY tsconfig*.json vite.config.ts index.html ./
COPY build/ ./build/
COPY public/ ./public/
COPY src/ ./src/

# Relative, because the API answers on this same origin.
ENV VITE_API_URL=/api

RUN npm run build:app

# --- the API ----------------------------------------------------------------

FROM rust:1.97-bookworm@sha256:77fac8b98f9f46062bb680b6d25d5bcaabfc400143952ebc572e924bcbedc3fa AS api

WORKDIR /build

# Manifests first: dependencies are the slow part and they change rarely.
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir -p src \
    && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY server/src/ ./src/
COPY server/migrations/ ./migrations/

# The placeholder above left a stale timestamp behind, and cargo would otherwise
# decide there was nothing to rebuild.
RUN touch src/main.rs && cargo build --release --locked

# --- what ships -------------------------------------------------------------

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:fccdbb0a547c14e23fcf4ce8ad62ca5d43b4faae8d22cd292f490fef9946c96e

WORKDIR /app

COPY --from=api /build/target/release/rankroom-server /app/rankroom-server
COPY --from=web /build/dist /app/web

ENV BIND=0.0.0.0:8080 \
    STATIC_DIR=/app/web

USER 65532:65532
EXPOSE 8080

# The binary probes itself: there is no shell here to run a curl in, and no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/app/rankroom-server", "--health-check"]

ENTRYPOINT ["/app/rankroom-server"]
