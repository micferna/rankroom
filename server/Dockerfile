# Build in a full toolchain, ship almost nothing.
FROM rust:1.97-bookworm AS build
WORKDIR /build

# Dependencies first: they change far less often than the source, so this layer
# survives most rebuilds.
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
 && echo 'fn main() {}' > src/main.rs \
 && echo '' > src/lib.rs \
 && cargo build --release --locked \
 && rm -rf src

COPY src ./src
COPY migrations ./migrations
# Touch so cargo notices the real sources replaced the stubs.
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

# Distroless: no shell, no package manager, nothing to pivot to if the process
# is ever compromised.
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app

COPY --from=build /build/target/release/rankroom-server /app/rankroom-server

USER nonroot
EXPOSE 8080
ENV BIND=0.0.0.0:8080

ENTRYPOINT ["/app/rankroom-server"]
