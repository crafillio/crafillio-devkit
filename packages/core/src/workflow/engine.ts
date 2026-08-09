/**
 * Workflow execution.
 *
 * Steps run in order. Each one resolves its inputs against a context built
 * from earlier steps, sends its request, then publishes named outputs back
 * into that context for the steps that follow.
 *
 * Every stage emits start and finish events so the UI can show progress live
 * and let the user open any stage — successful or failed — to see exactly what
 * was sent and received.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { sendRest } from '../protocols/rest.js';
import { createUnaryInvoker } from '../protocols/grpc.js';
import { evaluateCondition } from './condition.js';
import type { GrpcRequest, RestRequest, RestResponse } from '../types.js';
import { getPath, stringifyValue } from './extract.js';
import type {
  InputSource,
  RunResult,
  StepRecord,
  Workflow,
  WorkflowEvent,
  WorkflowStep,
} from './types.js';

/**
 * Execution order.
 *
 * With canvas edges present, steps run in dependency order — a node only runs
 * once everything feeding it has finished. Without edges we fall back to the
 * array order, which is what list-built workflows rely on.
 *
 * A cycle cannot be executed, so the remaining nodes are appended in array
 * order and the offending step fails naturally on its unresolved inputs rather
 * than hanging the run.
 */
export function orderSteps(workflow: Workflow): WorkflowStep[] {
  const edges = workflow.edges ?? [];
  if (edges.length === 0) return workflow.steps;

  const byId = new Map(workflow.steps.map((s) => [s.id, s]));
  const indegree = new Map(workflow.steps.map((s) => [s.id, 0]));
  const next = new Map<string, string[]>();

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
  }

  // Seed with roots, keeping the author's left-to-right ordering stable.
  const queue = workflow.steps.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const ordered: WorkflowStep[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(byId.get(id)!);

    for (const child of next.get(id) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if ((indegree.get(child) ?? 0) === 0) queue.push(child);
    }
  }

  for (const step of workflow.steps) if (!seen.has(step.id)) ordered.push(step);
  return ordered;
}

/** Values longer than this are truncated for display, never for sending. */
const DISPLAY_LIMIT = 2000;

/** Response bodies above this are kept as artifacts rather than inlined. */
const INLINE_BODY_LIMIT = 256 * 1024;

function truncate(value: string): { value: string; truncated: boolean } {
  if (value.length <= DISPLAY_LIMIT) return { value, truncated: false };
  return { value: `${value.slice(0, DISPLAY_LIMIT)}…`, truncated: true };
}

function describeSource(source: InputSource): string {
  switch (source.from) {
    case 'body':
      return `step response body → ${source.path || '(whole body)'}`;
    case 'header':
      return `step response header → ${source.header}`;
    case 'status':
      return 'step response status';
    case 'rawBody':
      return 'step response body (raw)';
    case 'literal':
      return 'literal value';
    case 'file':
      return `file → ${basename(source.path)} (${source.as})`;
  }
}

/** Substitutes {{name}} from the context. Unknown names are left visible. */
function interpolate<T>(node: T, context: Record<string, string>, missing: Set<string>): T {
  if (typeof node === 'string') {
    return node.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
      if (Object.prototype.hasOwnProperty.call(context, name)) return context[name]!;
      missing.add(name);
      return match;
    }) as T;
  }
  if (Array.isArray(node)) return node.map((child) => interpolate(child, context, missing)) as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = interpolate(value, context, missing);
    return out as T;
  }
  return node;
}

/**
 * Sleeps, but notices cancellation. A plain setTimeout would leave a cancelled
 * run sitting out the rest of a long polling interval before it noticed.
 */
async function delay(ms: number, isCancelled: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isCancelled()) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now())));
  }
}

/** Parses a response body as JSON, or returns undefined when it is not JSON. */
function parseJson(response: RestResponse): unknown {
  if (response.bodyEncoding !== 'utf8') return undefined;
  try {
    return JSON.parse(response.body);
  } catch {
    return undefined;
  }
}

interface StepState {
  response?: RestResponse;
  json?: unknown;
}

async function resolveInput(
  source: InputSource,
  states: Map<string, StepState>,
  grpcResults: Map<string, unknown>,
): Promise<string | undefined> {
  switch (source.from) {
    case 'literal':
      return source.value;

    case 'file': {
      const contents = await readFile(source.path);
      return source.as === 'base64' ? contents.toString('base64') : contents.toString('utf8');
    }

    case 'status': {
      const state = states.get(source.stepId);
      if (state?.response) return String(state.response.status);
      // A gRPC step that produced a message succeeded, i.e. status OK.
      return grpcResults.has(source.stepId) ? '0' : undefined;
    }

    case 'rawBody': {
      const state = states.get(source.stepId);
      if (state?.response) return state.response.body;
      return grpcResults.has(source.stepId)
        ? JSON.stringify(grpcResults.get(source.stepId))
        : undefined;
    }

    case 'header': {
      const headers = states.get(source.stepId)?.response?.headers;
      if (headers) return headers[source.header.toLowerCase()];
      // gRPC metadata is not captured per-call today; say so rather than
      // silently resolving to nothing.
      if (grpcResults.has(source.stepId)) {
        throw new Error('Response headers are not available from a gRPC step.');
      }
      return undefined;
    }

    case 'body': {
      // gRPC already decoded its message; read straight from it.
      if (grpcResults.has(source.stepId)) {
        const value = getPath(grpcResults.get(source.stepId), source.path);
        return value === undefined ? undefined : stringifyValue(value);
      }
      const state = states.get(source.stepId);
      if (!state?.response) return undefined;
      // Re-parse lazily so a step whose body is not JSON still reports clearly.
      if (state.json === undefined) state.json = parseJson(state.response);
      if (state.json === undefined) {
        throw new Error(
          `Step "${source.stepId}" did not return JSON, so "${source.path}" cannot be read from it.`,
        );
      }
      const value = getPath(state.json, source.path);
      return value === undefined ? undefined : stringifyValue(value);
    }
  }
}

function snapshotRequest(request: RestRequest): NonNullable<StepRecord['request']> {
  const headers: Array<[string, string]> = request.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [h.key, h.value]);

  let body: string | undefined;
  switch (request.body.kind) {
    case 'json':
    case 'text':
      body = request.body.text;
      break;
    case 'form':
      body = request.body.fields
        .filter((f) => f.enabled && f.key.trim())
        .map((f) => `${f.key}=${f.value}`)
        .join('&');
      break;
    case 'multipart':
      body = request.body.fields
        .filter((f) => f.enabled && f.key.trim())
        .map((f) => `${f.key}: ${f.type === 'file' ? (f.filePath ?? '(file)') : f.value}`)
        .join('\n');
      break;
    case 'binary':
      body = request.body.filePath ? `(binary file: ${basename(request.body.filePath)})` : undefined;
      break;
    case 'none':
      break;
  }

  const query = request.query.filter((q) => q.enabled && q.key.trim());
  const url = query.length
    ? `${request.url}${request.url.includes('?') ? '&' : '?'}${query
        .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
        .join('&')}`
    : request.url;

  return { method: request.method, url, headers, body, bodyKind: request.body.kind };
}

/** Describes a gRPC call using the same fields the report renders for HTTP. */
function snapshotGrpc(request: GrpcRequest): NonNullable<StepRecord['request']> {
  return {
    method: 'gRPC',
    url: `${request.target.address} ${request.service}/${request.method}`,
    headers: request.metadata
      .filter((m) => m.enabled && m.key.trim())
      .map((m) => [m.key, m.value] as [string, string]),
    body: request.messages[0] ?? '',
    bodyKind: 'json',
  };
}

function guessContentType(headers: Record<string, string>): string {
  return (headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim();
}

function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    'application/json': 'json',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'text/html': 'html',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'application/xml': 'xml',
    'application/octet-stream': 'bin',
  };
  return map[contentType] ?? 'bin';
}

export interface WorkflowRun {
  runId: string;
  cancel(): void;
  done: Promise<RunResult>;
}

/** Starts a workflow. Events stream as it progresses. */
export function runWorkflow(
  workflow: Workflow,
  environment: Record<string, string>,
  onEvent: (event: WorkflowEvent) => void,
): WorkflowRun {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();

  let cancelled = false;
  const elapsed = (from = started): number => Number(process.hrtime.bigint() - from) / 1e6;

  const execute = async (): Promise<RunResult> => {
    onEvent({ type: 'run-start', runId, totalSteps: workflow.steps.length });

    // Environment variables seed the context; step outputs layer on top.
    const context: Record<string, string> = { ...environment };
    const states = new Map<string, StepState>();
    // gRPC has no RestResponse, so its decoded message is kept alongside.
    const grpcResults = new Map<string, unknown>();
    const records: StepRecord[] = [];

    const sequence = orderSteps(workflow);

    for (const [index, step] of sequence.entries()) {
      if (cancelled) {
        records.push(skipped(step, index, 'Run cancelled.'));
        continue;
      }

      onEvent({ type: 'step-start', runId, stepId: step.id, index });
      const stepStarted = process.hrtime.bigint();

      // Bindings read from either source without caring which protocol ran.
      const readState = (stepId: string): unknown =>
        grpcResults.has(stepId) ? grpcResults.get(stepId) : undefined;

      const record: StepRecord = {
        stepId: step.id,
        name: step.name,
        index,
        protocol: step.kind,
        status: 'running',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        resolvedInputs: [],
        extractedOutputs: [],
        artifacts: [],
      };

      try {
        /* 1. Resolve this step's inputs into the context. */
        for (const input of step.inputs) {
          let value: string | undefined;
          try {
            value = await resolveInput(input.source, states, grpcResults);
          } catch (err) {
            if (input.fallback === undefined) throw err;
            value = input.fallback;
          }

          if (value === undefined) {
            if (input.fallback === undefined) {
              throw new Error(
                `Input "${input.name}" resolved to nothing (${describeSource(input.source)}). ` +
                  'Set a fallback if this is expected to be missing sometimes.',
              );
            }
            value = input.fallback;
          }

          context[input.name] = value;
          const shown = truncate(value);
          record.resolvedInputs.push({
            name: input.name,
            value: shown.value,
            source: describeSource(input.source),
            truncated: shown.truncated,
          });
        }

        /* 2. Optional guard. */
        if (step.runIf !== undefined && step.runIf.trim() !== '') {
          const verdict = evaluateCondition(step.runIf, context);
          if (verdict.unknown.length > 0) {
            throw new Error(
              `Condition refers to ${verdict.unknown.map((n) => `{{${n}}}`).join(', ')}, ` +
                'which no earlier step or environment variable provides.',
            );
          }
          if (!verdict.value) {
            records.push(skipped(step, index, `Condition "${step.runIf}" was not met.`));
            onEvent({ type: 'step-finish', runId, record: records[records.length - 1]! });
            continue;
          }
        }

        /* 3. Send, publish outputs, and poll when the step asks for it. */

        // A single attempt: send the request, then publish this step's outputs
        // into the shared context. Factored out so polling just calls it again
        // — each attempt overwrites the same variables, so {{status}} always
        // refers to the newest response rather than the first one.
        // The parsed body of the latest attempt, so a condition can reach into
        // it directly instead of requiring an output to be declared first.
        let lastJson: unknown;

        const attemptOnce = async (): Promise<void> => {
          const missing = new Set<string>();
          // Whatever the protocol, the JSON body a step publishes from.
          let json: unknown;

          if (step.kind === 'grpc') {
            const request = interpolate(step.grpc, context, missing);
            record.request = snapshotGrpc(request);

            if (missing.size > 0) {
              throw new Error(
                `Unresolved variable${missing.size === 1 ? '' : 's'} in this step: ` +
                  `${[...missing].map((m) => `{{${m}}}`).join(', ')}`,
              );
            }

            const callStarted = process.hrtime.bigint();
            // One channel per step: a workflow step is a single call, so pooling
            // across steps would keep connections open to servers no longer used.
            const invoker = await createUnaryInvoker(request);
            try {
              const result = await invoker.invoke();
              json = result.message ?? {};
              const body = JSON.stringify(json, null, 2);
              record.response = {
                status: 0,
                statusLabel: result.statusName,
                ok: true,
                headers: [],
                body,
                bodyEncoding: 'utf8',
                size: Buffer.byteLength(body),
                timingMs: Number(process.hrtime.bigint() - callStarted) / 1e6,
              };
            } catch (err) {
              const failure = err as Error & { statusName?: string; statusCode?: number };
              record.response = {
                status: failure.statusCode ?? 2,
                statusLabel: failure.statusName ?? 'UNKNOWN',
                ok: false,
                headers: [],
                body: failure.message,
                bodyEncoding: 'utf8',
                size: Buffer.byteLength(failure.message),
                timingMs: Number(process.hrtime.bigint() - callStarted) / 1e6,
              };
              throw new Error(`gRPC call failed: ${failure.statusName ?? ''} ${failure.message}`.trim());
            } finally {
              invoker.close();
            }

            grpcResults.set(step.id, json);
          } else {
            const request = interpolate(step.request, context, missing);
            record.request = snapshotRequest(request);

            if (missing.size > 0) {
              throw new Error(
                `Unresolved variable${missing.size === 1 ? '' : 's'} in this step: ` +
                  `${[...missing].map((m) => `{{${m}}}`).join(', ')}`,
              );
            }

            const response = await sendRest(request);
            states.set(step.id, { response });

            const contentType = guessContentType(response.headers);
            const inlineBody =
              response.body.length > INLINE_BODY_LIMIT
                ? `${response.body.slice(0, INLINE_BODY_LIMIT)}…`
                : response.body;

            record.response = {
              status: response.status,
              ok: response.ok,
              headers: Object.entries(response.headers),
              body: inlineBody,
              bodyEncoding: response.bodyEncoding,
              size: response.size,
              timingMs: response.timing.totalMs,
            };

            // A binary response is a file the user will want out of the report.
            if (response.bodyEncoding === 'base64') {
              record.artifacts.push({
                name: `${step.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.${extensionFor(contentType)}`,
                contentType,
                base64: response.body,
                size: response.size,
              });
            }

            if (!response.ok) {
              throw new Error(`Request failed with HTTP ${response.status}.`);
            }

            json = parseJson(response);
            states.set(step.id, { response, json });
          }

          /* 4. Publish outputs. */

          lastJson = json;

          // Replaced, not appended: when polling, these describe the attempt
          // that just happened, not every attempt stacked on top of each other.
          record.extractedOutputs = [];

          for (const output of step.outputs) {
            const raw = output.path.trim() === '' ? json : getPath(json, output.path);
            const value = stringifyValue(raw);
            context[output.name] = value;
            const shown = truncate(value);
            record.extractedOutputs.push({
              name: output.name,
              value: shown.value,
              truncated: shown.truncated,
            });
          }

        };

        /**
         * Resolves `response.<path>` against the latest response body.
         *
         * A status is rarely at the top level — `data.demo.status` is at least
         * as common as `status` — and requiring an output to be declared
         * before it can be compared made the simple case a two-step job.
         * The `response.` prefix keeps it unambiguous against a user's own
         * output names.
         */
        const resolveResponsePath = (name: string): string | undefined => {
          const path = name.startsWith('response.')
            ? name.slice('response.'.length)
            : name.startsWith('body.')
              ? name.slice('body.'.length)
              : null;
          if (path === null || lastJson === undefined) return undefined;
          const value = getPath(lastJson, path);
          return value === undefined ? undefined : stringifyValue(value);
        };

        const repeat = step.repeat;

        if (!repeat) {
          await attemptOnce();
        } else {
          if (repeat.maxAttempts < 1) throw new Error('maxAttempts must be at least 1.');
          if (repeat.until.trim() === '') throw new Error('A polling step needs an "until" condition.');

          record.attempts = 0;
          record.pollLog = [];

          // The delay counts against the overall timeout: "give up after 30s"
          // should mean 30 seconds from here, not 30 seconds after the wait.
          const deadline =
            repeat.timeoutMs && repeat.timeoutMs > 0 ? Date.now() + repeat.timeoutMs : null;
          let interval = Math.max(0, repeat.intervalMs);

          if (repeat.initialDelayMs !== undefined && repeat.initialDelayMs > 0) {
            const wait =
              deadline === null
                ? repeat.initialDelayMs
                : Math.min(repeat.initialDelayMs, deadline - Date.now());
            await delay(wait, () => cancelled);
            if (cancelled) throw new Error('Run cancelled while waiting to poll.');
          }

          for (;;) {
            record.attempts += 1;
            const attempt = record.attempts;
            let attemptError: string | undefined;

            try {
              await attemptOnce();
            } catch (err) {
              // Without retryOnError a failed attempt is simply a failed step;
              // retrying it would hide a broken endpoint behind a long wait.
              if (!repeat.retryOnError) throw err;
              attemptError = (err as Error).message;
            }

            const summary =
              record.extractedOutputs.map((o) => `${o.name}=${o.value}`).join(' ') || 'no outputs';

            let settled = false;
            if (attemptError === undefined) {
              // failIf is checked first: a job that has permanently failed
              // should stop now rather than after every remaining attempt.
              if (repeat.failIf !== undefined && repeat.failIf.trim() !== '') {
                const bad = evaluateCondition(repeat.failIf, context, resolveResponsePath);
                if (bad.value) {
                  record.pollLog.push({ attempt, elapsedMs: elapsed(stepStarted), summary, settled: false });
                  throw new Error(
                    `Stopped polling after ${attempt} attempt${attempt === 1 ? '' : 's'}: ` +
                      `"${repeat.failIf}" held. Last saw ${summary}.`,
                  );
                }
              }

              const verdict = evaluateCondition(repeat.until, context, resolveResponsePath);
              if (verdict.unknown.length > 0) {
                throw new Error(
                  `The until condition refers to ${verdict.unknown.map((n) => `{{${n}}}`).join(', ')}, ` +
                    'which this step does not publish. Add it as an output.',
                );
              }
              settled = verdict.value;
            }

            record.pollLog.push({
              attempt,
              elapsedMs: elapsed(stepStarted),
              summary,
              settled,
              ...(attemptError === undefined ? {} : { error: attemptError }),
            });

            if (settled) break;

            if (attempt >= repeat.maxAttempts) {
              throw new Error(
                `Gave up after ${attempt} attempt${attempt === 1 ? '' : 's'}: ` +
                  `"${repeat.until}" never held. Last saw ${summary}.` +
                  (attemptError === undefined ? '' : ` Last error: ${attemptError}`),
              );
            }
            if (deadline !== null && Date.now() >= deadline) {
              throw new Error(
                `Gave up after ${repeat.timeoutMs}ms: "${repeat.until}" never held. ` +
                  `Last saw ${summary}.`,
              );
            }
            if (cancelled) throw new Error('Run cancelled while polling.');

            // Never sleep past the deadline — otherwise a long interval turns
            // the timeout into "the timeout, rounded up to the next attempt".
            const wait = deadline === null ? interval : Math.min(interval, deadline - Date.now());
            await delay(wait, () => cancelled);
            if (cancelled) throw new Error('Run cancelled while polling.');

            if (repeat.backoff !== undefined && repeat.backoff > 1) {
              interval = Math.round(interval * repeat.backoff);
            }
          }
        }

        record.status = 'success';
      } catch (err) {
        record.status = 'failed';
        record.error = (err as Error).message;
      }

      record.durationMs = elapsed(stepStarted);
      records.push(record);
      onEvent({ type: 'step-finish', runId, record });

      if (record.status === 'failed' && !step.continueOnError) {
        // Everything after a hard failure is reported as skipped, so the run
        // reads as a complete picture rather than trailing off.
        for (const [laterIndex, later] of sequence.entries()) {
          if (laterIndex <= index) continue;
          const skippedRecord = skipped(later, laterIndex, 'An earlier step failed.');
          records.push(skippedRecord);
          onEvent({ type: 'step-finish', runId, record: skippedRecord });
        }
        break;
      }
    }

    const failed = records.filter((r) => r.status === 'failed').length;
    const succeeded = records.filter((r) => r.status === 'success').length;

    const result: RunResult = {
      runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      startedAt,
      durationMs: elapsed(),
      status: failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed',
      steps: records,
      context,
    };

    onEvent({ type: 'run-finish', runId, result });
    return result;
  };

  return { runId, cancel: () => { cancelled = true; }, done: execute() };
}

function skipped(step: WorkflowStep, index: number, reason: string): StepRecord {
  return {
    stepId: step.id,
    name: step.name,
    index,
    protocol: step.kind,
    status: 'skipped',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    resolvedInputs: [],
    extractedOutputs: [],
    artifacts: [],
    error: reason,
  };
}
