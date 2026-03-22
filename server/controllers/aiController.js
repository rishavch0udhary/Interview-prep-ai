require("dotenv").config();
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Helper: call Groq chat completion
async function groqChat(messages, jsonMode = false) {
  const options = {
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.7,
  };
  if (jsonMode) {
    options.response_format = { type: "json_object" };
  }
  const completion = await groq.chat.completions.create(options);
  return completion.choices[0]?.message?.content || "";
}

// Retry helper with exponential backoff for rate limit errors
async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error.status === 429;
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000;
        console.warn(`Rate limited. Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// Generate interview questions using Groq
exports.generateQuestions = async (role, experience, difficulty, count = 5) => {
  if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY not set. Using fallback questions.");
    return getFallbackQuestions(role);
  }
  try {
    const text = await callWithRetry(() =>
      groqChat([
        {
          role: "system",
          content: "You are a technical interview question generator. Return ONLY a JSON object with a key 'questions' containing an array of strings.",
        },
        {
          role: "user",
          content: `Generate ${count} interview questions for a ${role} with ${experience} years of experience. Difficulty: ${difficulty}. Return JSON: { "questions": ["Q1", "Q2", ...] }`,
        },
      ], true)
    );
    const parsed = JSON.parse(text);
    return parsed.questions || parsed;
  } catch (error) {
    console.error("AI Generation Error:", error);
    return getFallbackQuestions(role);
  }
};

// Evaluate an answer using Groq
exports.evaluateAnswer = async (question, answer) => {
  if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY not set. Using fallback evaluation.");
    return { feedback: "Unable to evaluate at this time.", score: 0 };
  }
  try {
    const text = await callWithRetry(() =>
      groqChat([
        {
          role: "system",
          content: "You are a technical interview evaluator. Evaluate the answer and return JSON with 'feedback' (string with Markdown formatting) and 'score' (number out of 10).",
        },
        {
          role: "user",
          content: `Question: "${question}"\nUser Answer: "${answer}"\nEvaluate this answer. Provide detailed feedback and a score out of 10. Use Markdown formatting (bold, bullet points) for clarity.\nReturn JSON: { "feedback": "string", "score": number }`,
        },
      ], true)
    );
    return JSON.parse(text);
  } catch (error) {
    console.error("AI Evaluation Error:", error);
    return { feedback: "Unable to evaluate at this time. The AI service is temporarily unavailable. Please try again in a few minutes.", score: 0 };
  }
};

// General Chat with AI
exports.chatWithAI = async (message, context = "") => {
  if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY not set. Using fallback response.");
    return "I am currently in offline mode. Please check your API key configuration.";
  }
  try {
    let systemInstruction = `You are a professional technical interviewer conducting a mock interview.`;
    if (context) {
      systemInstruction += `\nContext about the candidate: ${context}`;
    }
    systemInstruction += `
    Rules:
    1. If the user greets you, welcome them professionally and ask if they are ready to start.
    2. If the user asks a question, answer briefly and pivot back to interviewing them.
    3. If the user answers a question, evaluate it briefly (e.g., "Good point" or "Can you elaborate?") and ask a follow-up or a new technical question.
    4. Keep responses concise (under 50 words) and spoken-style (avoid markdown formatting like **bold** or lists).
    5. Maintain a professional, neutral, yet encouraging tone.
    6. Do not break character.`;

    const text = await callWithRetry(() =>
      groqChat([
        { role: "system", content: systemInstruction },
        { role: "user", content: message },
      ])
    );
    return text;
  } catch (error) {
    console.error("AI Chat Error:", error);
    return "I'm having trouble connecting right now. Please try again in a minute.";
  }
};

// Fallback questions by role when AI is unavailable
function getFallbackQuestions(role) {
  const roleLower = (role || "").toLowerCase();
  if (roleLower.includes("frontend") || roleLower.includes("react")) {
    return [
      "Explain the virtual DOM and how React uses it for efficient rendering.",
      "What are React hooks? Explain useState and useEffect with examples.",
      "How would you optimize the performance of a large React application?",
      "What is the difference between controlled and uncontrolled components?",
      "Explain the concept of lifting state up in React.",
    ];
  } else if (roleLower.includes("backend") || roleLower.includes("node")) {
    return [
      "Explain the event loop in Node.js and how it handles asynchronous operations.",
      "What is middleware in Express.js? Give an example of custom middleware.",
      "How do you handle authentication and authorization in a Node.js API?",
      "What are the differences between SQL and NoSQL databases?",
      "Explain RESTful API design principles and best practices.",
    ];
  } else if (roleLower.includes("fullstack") || roleLower.includes("mern")) {
    return [
      "Describe your experience with the MERN stack and its advantages.",
      "What is the difference between SQL and NoSQL databases?",
      "Explain the React component lifecycle and hooks.",
      "How do you handle state management in a full-stack application?",
      "What strategies do you use for API error handling and validation?",
    ];
  } else {
    return [
      "Tell me about a challenging technical problem you solved recently.",
      "How do you approach debugging a complex issue in production?",
      "What is your experience with version control and CI/CD pipelines?",
      "Explain a design pattern you frequently use and why.",
      "How do you ensure code quality and maintainability in your projects?",
    ];
  }
}
