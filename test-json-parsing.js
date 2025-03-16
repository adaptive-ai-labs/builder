/*
 * Simple JSON parsing test to verify our improvements
 * Run with: node test-json-parsing.js
 */

// No import needed for this test, we're just testing the JSON parsing logic

// Sample malformed JSON responses to test our parsing logic
const testCases = [
  // Case 1: Valid JSON array
  {
    name: 'Valid JSON array',
    input: `[
      {"label": "Setup HTML structure", "description": "Create initial HTML file", "category": "frontend", "status": "pending"},
      {"label": "Style the UI", "description": "Add CSS styling", "category": "frontend", "status": "pending"}
    ]`,
  },

  // Case 2: Valid JSON object (not array)
  {
    name: 'Valid JSON object',
    input: `{"label": "Setup HTML structure", "description": "Create initial HTML file", "category": "frontend", "status": "pending"}`,
  },

  // Case 3: Malformed JSON with extra commas
  {
    name: 'JSON with extra commas',
    input: `[
      {"label": "Setup HTML structure", "description": "Create initial HTML file", "category": "frontend", "status": "pending"},
      {"label": "Style the UI", "description": "Add CSS styling", "category": "frontend", "status": "pending"},
    ]`,
  },

  // Case 4: JSON with missing quotes
  {
    name: 'JSON with missing quotes',
    input: `[
      {"label": Setup HTML structure, "description": "Create initial HTML file", "category": "frontend", "status": "pending"},
      {"label": "Style the UI", "description": "Add CSS styling", "category": "frontend", "status": "pending"}
    ]`,
  },

  // Case 5: JSON with code fence markers (common in LLM responses)
  {
    name: 'JSON with code fence markers',
    input:
      '```json\n[' +
      `
      {"label": "Setup HTML structure", "description": "Create initial HTML file", "category": "frontend", "status": "pending"},
      {"label": "Style the UI", "description": "Add CSS styling", "category": "frontend", "status": "pending"}
    ]` +
      '\n```',
  },

  // Case 6: Complex object containing both tasks array and metadata
  {
    name: 'Complex nested structure',
    input: `{
      "buildPlan": {
        "tasks": [
          {"label": "Setup HTML structure", "description": "Create initial HTML file", "category": "frontend", "status": "pending"},
          {"label": "Style the UI", "description": "Add CSS styling", "category": "frontend", "status": "pending"}
        ]
      }
    }`,
  },
];

// Function to clean up the response text similar to our API implementation
function cleanJsonText(text) {
  // Remove Markdown code block syntax if present
  let cleanedText = text.replace(/^```(?:json)?/, '').replace(/```$/, '');

  // Attempt to extract JSON if wrapped in other text
  const jsonMatch = cleanedText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);

  if (jsonMatch) {
    cleanedText = jsonMatch[0];
  }

  return cleanedText.trim();
}

// Function to attempt to parse JSON with various fallback mechanisms
function safeParse(text) {
  // First, clean the text
  const cleanedText = cleanJsonText(text);
  console.log('Cleaned text:', cleanedText.substring(0, 50) + (cleanedText.length > 50 ? '...' : ''));

  try {
    // Attempt direct parse
    console.log('Attempting standard JSON parse');

    const result = JSON.parse(cleanedText);
    console.log('✅ Parse successful!');

    return { success: true, data: result };
  } catch (parseError) {
    console.log('❌ Standard parse failed:', parseError.message);

    // Recovery attempt 1: Try parsing as single object if it looks like one
    if (cleanedText.trim().startsWith('{') && cleanedText.trim().endsWith('}')) {
      try {
        console.log('Attempting to parse as single object');

        const singleObject = JSON.parse(cleanedText.trim());
        console.log('✅ Single object parse successful!');

        return { success: true, data: [singleObject] };
      } catch (singleObjError) {
        console.log('❌ Single object parse failed:', singleObjError.message);
      }
    }

    // Recovery attempt 2: Fix common JSON syntax errors
    try {
      console.log('Attempting to fix common JSON syntax errors');

      // Fix trailing commas
      const fixedTrailingCommas = cleanedText.replace(/,(\s*[\]}])/g, '$1');
      const result = JSON.parse(fixedTrailingCommas);
      console.log('✅ Fixed trailing commas parse successful!');

      return { success: true, data: result };
    } catch (fixError) {
      console.log('❌ Fixed trailing commas parse failed:', fixError.message);
    }

    // All recovery attempts failed
    return { success: false, error: parseError.message };
  }
}

// Test the parsing logic on each test case
function runTests() {
  console.log('=== TESTING JSON PARSING LOGIC ===\n');

  testCases.forEach((testCase, index) => {
    console.log(`\n=== TEST CASE ${index + 1}: ${testCase.name} ===`);
    console.log('Input sample:', testCase.input.substring(0, 50) + (testCase.input.length > 50 ? '...' : ''));

    const result = safeParse(testCase.input);

    if (result.success) {
      console.log('Result type:', Array.isArray(result.data) ? 'Array' : typeof result.data);
      console.log('Result structure:', JSON.stringify(result.data).substring(0, 100) + '...');

      // For arrays, also show count and first item
      if (Array.isArray(result.data)) {
        console.log(`Array length: ${result.data.length}`);

        if (result.data.length > 0) {
          console.log('First item:', JSON.stringify(result.data[0], null, 2));
        }
      }
    } else {
      console.log('❌ All parsing attempts failed:', result.error);
    }
  });
}

// Run the tests
runTests();
