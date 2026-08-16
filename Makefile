# veil -- an encrypted, TLS-camouflaged tunnel

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
GOFLAGS := -trimpath

BIN := bin
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

.PHONY: all build test race vet fmt lint clean release install-server help

all: build

## build: compile both binaries for this machine
build:
	go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN)/veil-server ./cmd/veil-server
	go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN)/veil-client ./cmd/veil-client
	@echo "built $(VERSION) into $(BIN)/"

## test: run the test suite
test:
	go test -count=1 ./...

## race: run the test suite under the race detector
race:
	go test -race -count=1 ./...

## vet: run go vet
vet:
	go vet ./...

## fmt: format all sources
fmt:
	gofmt -w .

## lint: formatting and vet checks, as CI runs them
lint: vet
	@test -z "$$(gofmt -l .)" || { echo "unformatted files:"; gofmt -l .; exit 1; }

## release: cross-compile for every supported platform
release:
	@for platform in $(PLATFORMS); do \
		os=$${platform%/*}; arch=$${platform#*/}; ext=""; \
		if [ "$$os" = "windows" ]; then ext=".exe"; fi; \
		for cmd in veil-server veil-client; do \
			echo "  $$os/$$arch  $$cmd"; \
			GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build $(GOFLAGS) \
				-ldflags "$(LDFLAGS)" \
				-o $(BIN)/$$os-$$arch/$$cmd$$ext ./cmd/$$cmd || exit 1; \
		done; \
	done
	@echo "release binaries are in $(BIN)/"

## clean: remove build output
clean:
	rm -rf $(BIN)

## help: list targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
