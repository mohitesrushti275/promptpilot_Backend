async function test() {
  const res = await fetch('http://localhost:3000/api/design-manifest/reference-to-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceUrl: 'https://nineorangelandscaping.com/',
      sections: []
    })
  });
  
  const data = await res.json();
  console.log('Success:', data.success);
  console.log('Prompt length:', data.prompt ? data.prompt.length : 0);
  console.log('Prompt preview:', data.prompt ? data.prompt.substring(0, 100) : 'null');
  delete data.screenshotUrl; // Hide large base64
  console.log('Full JSON Keys:', Object.keys(data.structuredPrompt));
}

test().catch(console.error);
