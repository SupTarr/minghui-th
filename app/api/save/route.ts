import { NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/gdrive";
import { isAuthorized } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const article = await req.json();
    const { url, title_en, title_th, content_en, content_th, date } = article;

    if (!url || !title_en || !title_th || !content_en || !content_th || !date) {
      return NextResponse.json(
        { error: "Missing required article fields in request body" },
        { status: 400 },
      );
    }

    // 1. Extract article ID from URL (e.g., 234818 from .../234818.html)
    const idMatch = url.match(/\/(\d+)\.html/);
    if (!idMatch) {
      return NextResponse.json(
        { error: `Could not parse article ID from URL: ${url}` },
        { status: 400 },
      );
    }
    const articleId = idMatch[1];

    // 2. Format names and content structure
    const folderName = date; // Format: YYYY-MM-DD
    const fileName = `${articleId}.json`;

    const articlePayload = {
      url,
      title_en,
      title_th,
      content_en,
      content_th,
      category: "Cultivation Insights",
      published_date: date,
      fetched_at: new Date().toISOString(),
    };

    // 3. Write individual article JSON to Drive folder
    await writeFile(folderName, fileName, articlePayload);

    // 4. Update index.json in the root folder
    interface IndexEntry {
      url: string;
      title_en: string;
      title_th: string;
      date: string;
      filePath: string;
    }
    let indexData: IndexEntry[] = [];
    try {
      const driveIndex = await readFile("index.json");
      if (driveIndex && Array.isArray(driveIndex)) {
        indexData = driveIndex as IndexEntry[];
      }
    } catch (e) {
      console.warn(
        "Index file not found or corrupted, creating a new index:",
        e,
      );
    }

    const newEntry = {
      url,
      title_en,
      title_th,
      date,
      filePath: `/${folderName}/${fileName}`,
    };

    // Prevent duplicates by checking if the URL already exists
    const existingIndex = indexData.findIndex((item) => item.url === url);
    if (existingIndex > -1) {
      indexData[existingIndex] = newEntry;
    } else {
      indexData.push(newEntry);
    }

    // Write updated index.json to root
    await writeFile(null, "index.json", indexData);

    return NextResponse.json({
      success: true,
      filePath: newEntry.filePath,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in /api/save:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
