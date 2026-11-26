import { post } from './api.mjs';
import { extractMail, explainWithGemini } from '../local-mail.mjs';

export async function review(text) {
  const graph = await post('graph');
  const baseVersion = graph.nodes.find(node => node.type === 'Move').props.version;
  const extracted = await extractMail(text);
  return extracted && { ...extracted, baseVersion };
}

export async function confirm(reviewed) {
  const result = await post('source/commit', { reviewed, explain: true });
  if (!result.after) throw new Error(result.detail || 'Please review the reply again.');
  const conflicts = result.after.checks.filter(check => check.status === 'conflict');
  const elevator = result.after.checks.find(check => check.id === 'elevator');
  const summary = [reviewed.statement, ...conflicts.map(check => check.detail || check.label)];
  if (elevator) summary.push(elevator.label + " · " + elevator.status);
  if (result.cloud) {
    summary.push("Fields for Gemini · " + JSON.stringify(result.cloud.facts));
    try {
      summary.push(await explainWithGemini(result.cloud.facts));
    } catch (error) {
      summary.push('Saved locally. Gemini explanation unavailable. ' + error.message);
    }
  }
  return summary.join('\n');
}
