async function test() {
  const res = await fetch('http://localhost:3000/api/design-manifest/reference-to-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceUrl: 'https://example.com',
      sections: []
    })
  });
  
  const data = await res.json();
  console.log('Success:', data.success);
  console.log('Prompt output:', typeof data.prompt, data.prompt?.substring(0, 50));
  console.log('Structured:', JSON.stringify(data.structuredPrompt).substring(0, 100));
}

test().catch(console.error);
