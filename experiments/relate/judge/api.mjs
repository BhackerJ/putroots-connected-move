import { createMoveGraph } from '../move-graph.mjs';
import { confirmedCloudFacts } from '../cloud-explanation.mjs';
const graph = createMoveGraph();
export async function post(path, input = {}) {
  switch (path) {
    case 'graph': return graph.graphView();
    case 'reset': return graph.reset();
    case 'conflicts': return graph.findConflicts(input);
    case 'compare': return graph.compareOptions(input);
    case 'source/commit': {
      const result = graph.applySource({ reviewed:input.reviewed });
      if (result.after && input.explain) result.cloud = confirmedCloudFacts(input.reviewed.statement,graph);
      return result;
    }
    default: throw new Error('Unknown review action');
  }
}
