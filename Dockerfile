# --- build ---
FROM golang:1.24-alpine AS build

WORKDIR /src

# Dependencies first, so a source-only change does not refetch them.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG VERSION=docker
RUN CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o /out/veil-server ./cmd/veil-server && \
    CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o /out/veil-client ./cmd/veil-client

# --- runtime ---
# Static binaries need no distribution underneath them, and a scratch image has
# no shell for anyone who does find their way in.
FROM scratch

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/veil-server /veil-server
COPY --from=build /out/veil-client /veil-client

# Binding 443 inside the container needs no privilege; the host maps it.
EXPOSE 443
USER 65532:65532

ENTRYPOINT ["/veil-server"]
CMD ["-c", "/etc/veil/server.json"]
