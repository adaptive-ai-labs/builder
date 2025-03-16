/*
 * Simple build plan test script
 * Run this with: node test-build-plan.js
 */

async function testBuildPlan() {
  try {
    console.log('Testing build plan generation...');

    const response = await fetch('http://localhost:3000/api/build-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Create a chess game in HTML and CSS',
        model: 'openai/gpt-4o-mini',
        provider: {
          name: 'OpenRouter',
          apiKeyName: 'OPENROUTER_API_KEY',
        },
      }),
    });

    console.log('Response status:', response.status);

    const responseText = await response.text();
    console.log('Raw response text:', responseText.substring(0, 200) + '...');

    try {
      const data = JSON.parse(responseText);
      console.log('Parsed JSON successfully');
      console.log('Success:', data.success);
      console.log('Fallback used:', data.fallback);
      console.log('Message:', data.message);
      console.log('Task count:', Array.isArray(data.tasks) ? data.tasks.length : 'not an array');

      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        console.log('First 2 tasks:', JSON.stringify(data.tasks.slice(0, 2), null, 2));
      }
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      console.error('Response was not valid JSON');
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testBuildPlan();
