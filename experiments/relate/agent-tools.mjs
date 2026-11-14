const scenario = {
  scenario: { enum: ['current', 'optionId', 'dateOnly'] },
  optionId: { type: 'string' },
  date: { type: 'string', description: 'Local YYYY-MM-DD date.' },
};

function tool(name, description, properties, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

export const tools = [
  tool('find_conflicts', 'Get a current move or hypothetical date report, including evidence IDs and quotes. Use a dateOnly scenario for a date without a named quote.', scenario),
  tool('compare_options', 'Compare known mover quotes and their remaining constraints.', { optionIds: { type: 'array', items: { type: 'string' } } }),
  tool('explain', 'Explain a check using its ID and the scenario that produced it.', { ...scenario, id: { type: 'string' } }, ['id']),
  tool('prepare_source', 'Read pasted source material and propose a change for the user to review.', { text: { type: 'string' } }, ['text']),
];

export function callTool(graph, name, input = {}) {
  const { scenario, optionId, date } = input;
  switch (name) {
    case 'find_conflicts': return graph.findConflicts({ scenario, optionId, date });
    case 'compare_options': return graph.compareOptions({ optionIds: input.optionIds });
    case 'explain': return graph.explain({ id: input.id, scenario, optionId, date });
    case 'prepare_source': return graph.applySource({ text: input.text });
    default: throw new Error('Unknown move tool');
  }
}
