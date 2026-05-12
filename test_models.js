import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const key = (process.env.ANTHROPIC_API_KEY || '').trim();
console.log("Key length:", key.length);
console.log("Key start:", key.slice(0, 10));

const anthropic = new Anthropic({ 
  apiKey: key,
  organization: '62be46e4-4605-44d8-acd1-15ffe3a2da6a'
});

async function test() {
  try {
    console.log("Testing with claude-3-5-sonnet-20241022...");
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hello" }],
    });
    console.log("Success:", message.content[0].text);
  } catch (err) {
    console.error("Failed with 20241022:", err.message);
    
    try {
      console.log("Testing with claude-3-5-sonnet-20240620...");
      const message = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hello" }],
      });
      console.log("Success:", message.content[0].text);
    } catch (err2) {
      console.error("Failed with 20240620:", err2.message);
      
      try {
        console.log("Testing with claude-3-haiku-20240307...");
        const message = await anthropic.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }],
        });
        console.log("Success:", message.content[0].text);
      } catch (err3) {
        console.error("Failed with Haiku:", err3.message);
      }
    }
  }
}

test();
