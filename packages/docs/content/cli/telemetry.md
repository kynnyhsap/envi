---
title: "Logs and traces"
description: "The debug logs of the CLI, the log file, and the OpenTelemetry traces and logs over OTLP."
---

# Logs and traces

The CLI writes its logs to stderr. It also sends its spans and its logs to an OpenTelemetry
collector, and it writes its logs to a file, when you ask for them. A log or a span never holds a
secret value. Telemetry never fails a command and never changes its output.

## Debug logs

`--debug` shows every log on stderr. Without it, stderr shows only the logs of the level `INFO`
and above. `ENVI_DEBUG=true` does the same as `--debug`, and the flag wins:
`ENVI_DEBUG=true envi check --debug=false` shows no debug log.

A debug log names each step and its duration, the configs that Envi found, the stage and its
source, the settings of each resolution, the cache, and each provider batch with its references.

```sh
envi check --debug
envi check --debug --log-format json
```

## Log file

`ENVI_LOG_FILE=<file>` appends every log, including the debug logs, to the file as JSON lines. The
file does not change stderr. Each run appends to the same file.

```sh
ENVI_LOG_FILE=/tmp/envi.log envi sync
```

## OpenTelemetry

The CLI sends its spans and its logs over OTLP, to the collector of the standard OpenTelemetry
variables. Without an endpoint, the CLI sends nothing.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 envi sync
```

| Variable                             | Does                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | The base URL. Envi adds `/v1/traces` and `/v1/logs` to its path.       |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | The full URL of the spans. It wins over the base URL.                  |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`   | The full URL of the logs. It wins over the base URL.                   |
| `OTEL_EXPORTER_OTLP_PROTOCOL`        | `http/protobuf` or `http/json`, in any case. Default: `http/protobuf`. |
| `OTEL_EXPORTER_OTLP_HEADERS`         | Headers of each request, such as `authorization=Bearer%20<token>`.     |
| `OTEL_TRACES_EXPORTER`               | `none` sends no spans. Default: `otlp`.                                |
| `OTEL_LOGS_EXPORTER`                 | `none` sends no logs. Default: `otlp`.                                 |
| `OTEL_SDK_DISABLED`                  | `true`, in any case, sends nothing. Any other value changes nothing.   |
| `OTEL_RESOURCE_ATTRIBUTES`           | More attributes of the resource, such as `deployment.environment=ci`.  |

`OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`,
`OTEL_EXPORTER_OTLP_TRACES_HEADERS`, and `OTEL_EXPORTER_OTLP_LOGS_HEADERS` set one signal. A
variable of one signal wins over the variable of every signal. A header name or value that HTTP
does not allow, such as a name with a space, is a value that Envi cannot use. So is an endpoint
with a user or a password, such as `http://app:secret@localhost:4318`. Put the credentials in a
header instead.

`OTEL_TRACES_EXPORTER` and `OTEL_LOGS_EXPORTER` hold a list, such as `otlp,console`. Envi sends the
signal when the list holds `otlp`, and Envi uses no other exporter. A list of only `none` sends
nothing. Any other list, such as `zipkin`, is a value that Envi cannot use. Envi warns about it only
while an endpoint of the signal is set.

- The service name of every span and log is `envi`, with the version of Envi.
- The root span of a command is `envi <command>`, such as `envi sync`. Its children are the steps:
  the config search, the config import, the cache read, the provider batch, each `custom()`
  resolution, and the cache write. A span in user code, such as an `Effect.withSpan` in
  `custom()`, joins the trace.
- A failed span holds the error of the step. An Envi error shows its tag and its summary. Any other
  error shows only its name, such as `Error`, because its text can hold a secret or an argument of
  a command. The same rule covers an error in a log: in its cause, in its message, or in its
  annotations, on stderr, in the log file, and in OTLP. It also covers an error in an attribute of
  a span, an event, or a link. Envi finds an error at any depth of an array, a plain object, an
  `Option`, or a `Cause`. A plain object with a `_tag` counts as an error. A `Redacted` and a `Date`
  stay. Any other object or function in a log or an attribute shows only its type, such as
  `[object Map]`, because it can hold an error that Envi cannot reach. Envi copies only the data
  properties of a plain object or of the attributes, so a hook such as `toJSON` never runs, and a
  getter shows as `[Getter]`.
- Envi drops the attributes `url.full`, `url.path`, `url.query`, and the HTTP headers from each
  span, event, and link, because they can hold a secret. So a span of an HTTP request in user code
  holds the method, the host, the scheme, and the status. The request still sends `traceparent`,
  so the server joins the trace. A name that user code gives a span, or a value that it writes
  under another attribute, stays as the user code writes it.
- Envi waits for each batch in flight and sends the last batch before it exits. A collector that
  does not answer delays the exit by 2 seconds at most.
- The CLI supports only OTLP over HTTP. Another protocol, such as `grpc`, is a value that Envi
  cannot use.
- A variable that Envi cannot use turns off its signal, and only its signal. A warning on stderr
  names the variable and never shows its value. The command runs as usual.

## Trace context

When `TRACEPARENT` holds a W3C trace context, the root span of the command continues that trace.
A parent process, such as a test runner or a CI step, sets it. Envi ignores a value that breaks the
W3C rules, such as an ID of only zeros, and starts a new trace. A later version of the format
continues the trace, and Envi ignores its extra fields.

While the CLI sends its spans, `envi run` sets `TRACEPARENT` of the child to the span of the
command. A child that reads it continues the trace. Without an export, the child inherits
`TRACEPARENT` unchanged. A var named `TRACEPARENT` in the config wins.

## SDK

The SDK sets up no logger and no tracer. Its steps are Effect spans and Effect logs, so an Effect
program that provides a tracer and a logger receives them. See [Effect](../sdk/effect.md).
