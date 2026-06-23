import { NextResponse } from "next/server";
import { readFileAtPath } from "@/lib/gdrive";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("filePath");

    if (!filePath) {
      return NextResponse.json(
        { error: 'Missing required query parameter "filePath"' },
        { status: 400 },
      );
    }

    const content = await readFileAtPath(filePath);
    if (!content) {
      return NextResponse.json(
        { error: `Article at path "${filePath}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(content);
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/article:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
