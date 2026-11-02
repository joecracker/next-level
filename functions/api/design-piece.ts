import { GoogleGenAI, Type } from "@google/genai";

// Cloudflare Worker route (built with `wrangler pages functions build`) - serves POST /api/design-piece
// The Design Studio's "Ask AI to build it" helper: turns a plain description of a custom piece (a linen tower,
// a corner shelf, a mantel) into a short list of simple parts, or asks a few questions first.
// It only ever returns data (a list of parts), never code. The app checks and clamps every number it gets back.

interface Env {
  GEMINI_API_KEY?: string;
  AI_API_KEY?: string; // older name for the same key
}

// Same fallback list as the Polish route: if one model is retired or out of quota, the next one is tried.
const MODEL_CANDIDATES = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const RETRYABLE_FAILURE = /not found|not supported|unsupported|deprecated|quota|rate limit|resource_exhausted|429|404|503|overloaded|unavailable/i;
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

const SYSTEM = `You design simple custom furniture-like pieces for a kitchen and bath remodeling drawing tool. You turn a plain description into a short list of PARTS. All sizes are in inches.

Each part is a straight-sided solid with these fields:
- name: short, like "Left side", "Shelf 2", "Granite top"
- shape: "box" (a rectangle seen from above), "tri" (a right triangle seen from above, right angle at x,y), or "wedge" (a triangle with small flat ends, made to fill a 90 degree room corner)
- mat: "paint" (painted or cabinet-colored), "tile", "wood", or "stone" (granite / quartz top)
- color: a hex color such as "#e8e6df"
- x: distance from the LEFT edge of the piece to the part's left edge
- y: distance from the BACK of the piece (the side against the wall) to the part's back edge
- z: height of the part's UNDERSIDE above the floor
- w: width of the part across (along x)
- d: depth of the part (along y)
- h: height or thickness of the part (up from z)
- rot: optional. Turns the part clockwise (seen from above) by this many degrees around the MIDDLE of its box, which is the point (x + w/2, y + d/2). Leave it out or use 0 for a straight part. Choose x and y as for the unturned box; for a turned part x and y may be negative.

The piece must be built from parts that actually touch or sit on each other, like real construction. Panels and shelves are 0.75 inch thick; tops are 0.75 to 1.5 inches; a toe-kick recess is usually 3 to 4 inches. Corner pieces: for a piece that fills a 90 degree room corner with an angled face, use shape "tri" for the top, bottom and shelves with x=0, y=0, and w=d=the length of each leg along the walls (the angled face is the long side; face length = leg x 1.414). To stand a divider SQUARE to that angled face at a point P=(px,py) on the face (px + py = leg), run it straight back along the direction (-1,-1) until it reaches a side wall: its length is L = 1.414 x min(px,py); make it a "box" with w = L - 0.5, d = its thickness, rot = 45, whose middle is at (px,py) minus (L/2.828) in both x and y; so x = midx - w/2 and y = midy - d/2. For one divider in the middle of the face: px = py = leg/2. Dividers must reach the shelves and top they sit between, so give them the full inside height. Keep it simple: use as few parts as make a sensible piece (usually 4 to 20, never more than 40). Do not model handles, hardware, screws or trim unless asked.
If a piece is not square from above, a "tri" or "wedge" part can make the shape; stack parts at different z values for shelves and tops.
Prefer the colors: white #ffffff, off-white #e8e6df, tile #e6e2d6, gray #9a9a96, navy #1f3a5f, wood #a0764e, dark wood #6b4a32, stone #b7b4ac. Use the colors the person asks for.

Reply with JSON only.
- If you still need important facts you cannot reasonably assume (overall size, how many shelves, material of the top) AND the person has not answered questions yet, reply with "ask": a list of at most 3 short plain-English questions, and no parts.
- Otherwise reply with "name" (a short name for the piece), "parts" (the list), and "note" (one short sentence saying what you assumed).
- If "current" parts are provided, the person wants to CHANGE that piece: return the full updated list of parts, keeping what they did not ask to change.
Never ask more than once. Assume sensible defaults for anything not covered.`;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  try {
    const apiKey = env.GEMINI_API_KEY || env.AI_API_KEY;
    if (!apiKey) return Response.json({ error: "not_configured" }, { status: 503 });

    const body = (await request.json()) as { request?: string; answers?: Array<{ q: string; a: string }>; current?: unknown };
    const text = typeof body.request === "string" ? body.request.trim().slice(0, 1500) : "";
    if (!text) return Response.json({ error: "Tell me what you want to build" }, { status: 400 });
    const answers = Array.isArray(body.answers) ? body.answers.slice(0, 5).map((x) => ({ q: String(x?.q || "").slice(0, 300), a: String(x?.a || "").slice(0, 300) })) : [];
    const current = Array.isArray(body.current) ? JSON.stringify(body.current).slice(0, 12000) : "";

    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "crackerbox-build" } } });
    const prompt = `${SYSTEM}

What the person wants: "${text}"
${answers.length ? "Their answers to your questions (do not ask again):\n" + answers.map((x) => `- ${x.q} -> ${x.a}`).join("\n") : "They have not answered any questions yet."}
${current ? "Current parts of the piece (change these as asked): " + current : "There is no current piece; design a new one."}`;

    const num = { type: Type.NUMBER };
    const response = await generateWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            ask: { type: Type.ARRAY, items: { type: Type.STRING } },
            name: { type: Type.STRING },
            note: { type: Type.STRING },
            parts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  shape: { type: Type.STRING, enum: ["box", "tri", "wedge"] },
                  mat: { type: Type.STRING, enum: ["paint", "tile", "wood", "stone"] },
                  color: { type: Type.STRING },
                  x: num, y: num, z: num, w: num, d: num, h: num, rot: num,
                },
                required: ["name", "shape", "mat", "x", "y", "z", "w", "d", "h"],
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return Response.json({
      success: true,
      ask: Array.isArray(parsed.ask) ? parsed.ask.slice(0, 3).map(String) : [],
      name: typeof parsed.name === "string" ? parsed.name : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
      parts: Array.isArray(parsed.parts) ? parsed.parts : [],
    });
  } catch (error) {
    console.error("Error designing custom piece:", error);
    return Response.json(
      { error: "The helper could not answer", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};
