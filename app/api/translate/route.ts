import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { authorize } from "@/lib/auth";
import { parseArticleHtml } from "@/lib/parseArticle";

export async function POST(req: Request) {
  try {
    const auth = await authorize(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", reason: auth.reason },
        { status: auth.status },
      );
    }

    const body = await req.json().catch(() => null);
    const url = body?.url;

    if (typeof url !== "string" || url.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid article URL" },
        { status: 400 },
      );
    }

    // 1. Fetch the individual article HTML
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch article page: status ${response.status}`,
      );
    }

    const html = await response.text();

    // 2. Extract English title & content paragraphs
    const { title_en, content_en } = parseArticleHtml(html);
    if (!title_en) {
      throw new Error("Could not find article title on the page.");
    }
    if (!content_en) {
      throw new Error(
        "Could not extract any content paragraphs from the article.",
      );
    }

    // 3. Initialize Gemini client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not defined.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash as the standard robust and fast model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `Translate the following English article to Thai. 
Return JSON only matching this schema:
{
  "title_th": "Translated Thai Title",
  "content_th": "Translated Thai Content"
}
Keep proper nouns (Falun Dafa, Minghui, etc.) unchanged.
Maintain all markdown formatting (such as headings starting with #, ##, ###, bullet points starting with -, blockquotes starting with >) exactly as they are in the translation (translate the text, keep the markdown syntax prefix).

Article title: ${title_en}
Article content: ${content_en}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let parsedTranslation: { title_th?: unknown; content_th?: unknown };
    try {
      parsedTranslation = JSON.parse(responseText);
    } catch {
      console.error("Failed to parse JSON response from Gemini:", responseText);
      throw new Error("Gemini API did not return valid JSON translation.");
    }

    // responseMimeType only guarantees valid JSON, not the right shape — there's
    // no responseSchema. Validate the keys exist as strings so a malformed model
    // reply fails here (at the real cause) instead of returning a 200 with
    // undefined fields that /api/save later rejects with a misleading 400.
    const { title_th, content_th } = parsedTranslation;
    if (typeof title_th !== "string" || typeof content_th !== "string") {
      console.error("Gemini JSON missing title_th/content_th:", responseText);
      throw new Error(
        "Gemini translation is missing title_th/content_th string fields.",
      );
    }

    return NextResponse.json({
      title_en,
      content_en,
      title_th,
      content_th,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in /api/translate:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
