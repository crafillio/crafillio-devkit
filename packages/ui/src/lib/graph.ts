import type { Workflow, WorkflowStep } from '@crafillio/core';

/**
 * Execution order for a canvas workflow.
 *
 * This mirrors `orderSteps` in `@crafillio/core/src/workflow/engine.ts`. It is
 * duplicated rather than imported because core is a CommonJS, Node-targeted
 * package — it reaches for `node:fs` and `node:crypto`, so the renderer bundle
 * cannot pull a value out of it. The logic is pure and small, and
 * `packages/core/test/workflow.test.mjs` asserts the two agree.
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

  // Anything left is part of a cycle; append it so it is still visible.
  for (const step of workflow.steps) if (!seen.has(step.id)) ordered.push(step);
  return ordered;
}
