import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isAuthorized } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'Missing article URL' }, { status: 400 });
    }

    // 1. Fetch the individual article HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch article page: status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 2. Extract English title & content paragraphs
    const title_en = $('.article-title').text().trim();
    if (!title_en) {
      throw new Error('Could not find article title on the page.');
    }

    const contentElements: string[] = [];
    $('.article-body-content')
      .find('p, h1, h2, h3, h4, h5, h6, blockquote, li, td, th, pre, code')
      .each((_, el) => {
        const element = $(el);
        // Skip metadata section (class="splitted") and copyright notices
        if (
          element.hasClass('splitted') ||
          element.closest('.splitted').length > 0 ||
          element.hasClass('copyright-notice') ||
          element.closest('.copyright-notice').length > 0
        ) {
          return;
        }

        // Avoid duplicating text by checking if an ancestor element is also in our matched set
        const parentSelected = element
          .parent()
          .closest('p, h1, h2, h3, h4, h5, h6, blockquote, li, td, th, pre, code');
        if (parentSelected.length > 0) {
          return;
        }

        let text = element.text().trim();
        if (!text) return;

        const tagName = el.tagName.toLowerCase();

        // Convert elements to standard markdown indicators for formatting
        if (tagName === 'h1') {
          text = `# ${text}`;
        } else if (tagName === 'h2') {
          text = `## ${text}`;
        } else if (tagName === 'h3') {
          text = `### ${text}`;
        } else if (tagName.startsWith('h')) {
          text = `#### ${text}`;
        } else if (tagName === 'blockquote') {
          text = `> ${text}`;
        } else if (tagName === 'li') {
          text = `- ${text}`;
        } else if (tagName === 'pre' || tagName === 'code') {
          text = `\`\`\`\n${text}\n\`\`\``;
        }

        contentElements.push(text);
      });

    const content_en = contentElements.join('\n\n');
    if (!content_en) {
      throw new Error('Could not extract any content paragraphs from the article.');
    }

    // 3. Initialize Gemini client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not defined.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash as the standard robust and fast model
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
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

    try {
      const parsedTranslation = JSON.parse(responseText);
      return NextResponse.json({
        title_en,
        content_en,
        title_th: parsedTranslation.title_th,
        content_th: parsedTranslation.content_th,
      });
    } catch (parseError) {
      console.error('Failed to parse JSON response from Gemini:', responseText);
      throw new Error('Gemini API did not return valid JSON translation.');
    }
  } catch (error: any) {
    console.error('Error in /api/translate:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
