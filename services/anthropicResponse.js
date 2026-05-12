/**
 * Model id for Claude Messages API. Override via ANTHROPIC_MODEL in .env.
 */
export function getAnthropicModel() {
  return (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6').trim();
}

/**
 * Text from a Messages API response (handles multiple / interleaved content blocks).
 */
export function anthropicMessageText(completion) {
  const blocks = completion?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('Anthropic returned no content blocks.');
  }
  const texts = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }
  if (!texts.length) {
    throw new Error(
      'Anthropic returned no text blocks (unexpected content layout). Check ANTHROPIC_MODEL and API behavior.'
    );
  }
  return texts.join('\n').trim();
}
