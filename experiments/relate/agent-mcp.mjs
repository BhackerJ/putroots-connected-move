import { createInterface } from 'node:readline';
import { tools } from './agent-tools.mjs';

for await (const line of createInterface({ input: process.stdin })) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  const { id, method, params } = message;
  if (id === undefined) continue;

  try {
    let result;
    if (method === 'initialize') {
      result = {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'putroots', version: '1.0.0' },
      };
    } else if (method === 'tools/list') {
      result = { tools };
    } else if (method === 'tools/call') {
      const response = await fetch(process.env.PUTROOTS_TOOL_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.PUTROOTS_TOOL_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: params.name, input: params.arguments }),
      });
      const data = await response.text();
      result = { content: [{ type: 'text', text: data }], ...(response.ok ? {} : { isError: true }) };
    } else if (method === 'ping') {
      result = {};
    } else {
      console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method' } }));
      continue;
    }
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
  } catch {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Tool connection failed' } }));
  }
}
