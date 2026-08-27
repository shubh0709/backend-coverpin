import { ParsedOwnershipRow } from './ownership-validator';
import { ValidationError } from './types';
import { makeError, normalizeName } from './common';

const FILE = 'ownership.csv';

export interface ExistingEdge {
  parentName: string;
  childName: string;
  pct: number;
}

/**
 * Validates the ownership graph after merging this upload's edges (upsert
 * semantics: new/changed edges overwrite by (parent, child), untouched
 * existing edges are kept) with whatever is already persisted. Cycle and
 * over-100% detection must run against this merged graph, not just the
 * upload in isolation, because a re-upload only carries the edges it
 * changed, not the whole history.
 */
export function validateOwnershipGraph(
  rows: ParsedOwnershipRow[],
  existingEdges: ExistingEdge[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Node identity in this graph is Entity Name matched case-insensitively
  // (trimmed + lowercased) — the same normalized name from two differently
  // cased rows must resolve to the same node.
  const merged = new Map<string, number>();
  for (const edge of existingEdges) {
    merged.set(
      `${normalizeName(edge.parentName)}|||${normalizeName(edge.childName)}`,
      edge.pct,
    );
  }
  for (const row of rows) {
    merged.set(
      `${normalizeName(row.parentEntity)}|||${normalizeName(row.childEntity)}`,
      row.ownershipPct,
    );
  }

  const adjacency = new Map<string, string[]>();
  for (const key of merged.keys()) {
    const [parent, child] = key.split('|||');
    const children = adjacency.get(parent) ?? [];
    children.push(child);
    adjacency.set(parent, children);
  }

  const cyclicNodes = detectCyclicNodes(adjacency);

  if (cyclicNodes.size > 0) {
    for (const row of rows) {
      if (
        cyclicNodes.has(normalizeName(row.parentEntity)) &&
        cyclicNodes.has(normalizeName(row.childEntity))
      ) {
        errors.push(
          makeError(
            FILE,
            row.line,
            'Parent Entity',
            `Ownership cycle detected: '${row.parentEntity}' -> '${row.childEntity}' is part of a cycle (directly or through other entities).`,
          ),
        );
      }
    }
  }

  const totalsByChild = new Map<string, number>();
  for (const [key, pct] of merged) {
    const [, child] = key.split('|||');
    totalsByChild.set(child, (totalsByChild.get(child) ?? 0) + pct);
  }
  for (const row of rows) {
    const total = totalsByChild.get(normalizeName(row.childEntity)) ?? 0;
    if (total > 100) {
      errors.push(
        makeError(
          FILE,
          row.line,
          'Ownership %',
          `Total ownership of '${row.childEntity}' across all parents is ${total.toFixed(2)}%, which exceeds 100%.`,
        ),
      );
    }
  }

  return errors;
}

function detectCyclicNodes(adjacency: Map<string, string[]>): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cyclic = new Set<string>();
  const stack: string[] = [];

  const allNodes = new Set<string>();
  for (const [parent, children] of adjacency) {
    allNodes.add(parent);
    for (const child of children) allNodes.add(child);
  }

  function visit(node: string): void {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === WHITE) {
        visit(next);
      } else if (nextColor === GRAY) {
        const cycleStart = stack.indexOf(next);
        for (const cycleNode of stack.slice(cycleStart)) cyclic.add(cycleNode);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of allNodes) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }

  return cyclic;
}
