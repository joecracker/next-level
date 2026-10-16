import { GoogleGenAI, Type } from "@google/genai";

// Cloudflare Worker route (built with `wrangler pages functions build`) — serves POST /api/format-section
// Polish for the Capture screen: turns a contractor's spoken/typed job notes into one clean,
// ordered scope list, from tear-out through debris removal.

interface Env {
  GEMINI_API_KEY?: string;
  // Older deployments set the same key under this name; accept either.
  AI_API_KEY?: string;
}

// Tried in order: the quality model first, tighter/cheaper ones behind it as backups.
// If Google retires one of these, or a free-tier quota runs out, the request slides
// to the next instead of failing outright. Same list as the Proposal app.
const MODEL_CANDIDATES = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
];

// Worth retrying on a different model: retired or unknown model, quota, overload.
// Anything else (a rejected key, bad request) should fail right away.
const RETRYABLE_FAILURE =
  /not found|not supported|unsupported|deprecated|quota|rate limit|resource_exhausted|429|404|503|overloaded|unavailable/i;

type GenerateParams = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

async function generateWithFallback(ai: GoogleGenAI, params: GenerateParams) {
  let lastError: unknown;

  for (const model of MODEL_CANDIDATES) {
    try {
      return await ai.models.generateContent({ ...params, model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error;
      if (!RETRYABLE_FAILURE.test(message)) throw error;
      console.warn(`[ai] model ${model} unavailable, trying next: ${message}`);
    }
  }

  throw lastError;
}

// Tim's proposals say "Remove", never "Demolish" / "Demo" / "Demolition". The prompt asks for that,
// and this tidies up any line where the model still slips.
const WORD_SWAPS: Record<string, string> = {
  demolish: "remove",
  demolishes: "removes",
  demolished: "removed",
  demolishing: "removing",
  demo: "remove",
  demolition: "removal",
};

export const cleanWording = (line: string): string =>
  line
    .replace(/\bdemolition\s+debris\b/gi, "debris")
    .replace(/\b(demolishing|demolishes|demolished|demolish|demolition|demo)\b/gi, (word) => {
      const swap = WORD_SWAPS[word.toLowerCase()];
      return word[0] === word[0].toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap;
    });

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  try {
    const apiKey = env.GEMINI_API_KEY || env.AI_API_KEY;
    if (!apiKey) {
      // The app shows "Polish isn't connected yet" for this.
      return Response.json({ error: "not_configured" }, { status: 503 });
    }

    const body = (await request.json()) as { rawInput?: string };
    const { rawInput } = body;

    if (!rawInput || typeof rawInput !== "string") {
      return Response.json({ error: "Missing or invalid rawInput" }, { status: 400 });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "crackerbox-build",
        },
      },
    });

    const prompt = `You are an expert construction project manager and estimator.
A remodeling contractor has dictated or typed rough notes describing a whole job, start to finish. Turn them into ONE clear, ordered scope list that reads like a professional scope of work.

Raw job notes: "${rawInput}"

Guidelines:
1. Put the steps in the order the work is actually done: start with tear-out / removal, then rough work (framing, plumbing, electrical), then surfaces and finishes, then fixtures, trim and final touches, and end with debris removal and clean-up.
2. Break the notes into distinct, professional line items. Recognize natural pauses, action verbs, materials, dimensions and scope changes automatically; the notes will not contain phrases like "next line" or "bullet point".
3. Use precise, clear construction terminology (for example: "Install 1/2 in. moisture-resistant drywall", "Furnish and install 3/4 in. oak hardwood flooring").
4. Keep every quantity, size, measurement, material, brand and color the contractor mentioned, exactly as given. Never invent numbers, materials or work that was not mentioned.
5. Keep each line item sharp, concise and professional. One task per line.
6. Wording rule: never use the words "demolish", "demolition" or "demo" in a line item. Say "Remove" instead (for example: "Remove existing bathtub and tub surround.").
7. If the notes do not mention debris, do not add it. If they do, put it last.

Return JSON in this format:
{
  "formattedItems": [
    "Line item 1...",
    "Line item 2..."
  ],
  "summary": "Brief 1-sentence summary of changes made"
}`;

    const response = await generateWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            formattedItems: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Ordered list of cleanly formatted scope line items",
            },
            summary: {
              type: Type.STRING,
              description: "Summary of formatting applied",
            },
          },
          required: ["formattedItems"],
        },
      },
    });

    const resultText = response.text || "{}";
    const parsed = JSON.parse(resultText);

    return Response.json({
      success: true,
      formattedItems: (parsed.formattedItems || []).map((item: string) => cleanWording(String(item))),
      summary: parsed.summary || "Items formatted successfully",
    });
  } catch (error) {
    console.error("Error polishing job notes:", error);
    return Response.json(
      { error: "Failed to format text with AI", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};
