import { generateObject } from 'ai';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { extractionModel, createLogger } from '@retailer/core';
import { type RawExtractedProduct } from '@retailer/schema';

const log = createLogger('crawler:llm');

/** Schema the model fills. Kept flat + lenient; pipeline normalizes later. */
const LlmProductSchema = z.object({
  title: z.string(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  categoryPath: z.array(z.string()),
  price: z.number().nullable(),
  listPrice: z.number().nullable(),
  currency: z.enum(['CAD', 'USD']),
  availability: z.enum(['in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown']),
  retailerSku: z.string().nullable(),
  gtin: z.string().nullable(),
  mpn: z.string().nullable(),
  imageUrl: z.string().nullable(),
  attributes: z.record(z.string(), z.string()),
});

/**
 * LLM fallback extractor. We strip the HTML down to visible text + key meta to
 * keep token cost low, then ask the Gateway model for structured fields.
 */
export async function extractWithLlm(
  html: string,
  url: string,
  retailerKey: string,
): Promise<RawExtractedProduct | null> {
  const condensed = condenseHtml(html);
  if (condensed.length < 40) return null;

  try {
    const { object } = await generateObject({
      model: extractionModel(),
      schema: LlmProductSchema,
      system:
        'You extract a single product from a retail product page. ' +
        'Prices are numeric major units (e.g. 199.99). If a field is unknown, use null. ' +
        'categoryPath is the breadcrumb from broad to specific.',
      prompt: `Retailer: ${retailerKey}\nURL: ${url}\n\nPAGE CONTENT:\n${condensed}`,
    });

    return {
      sourceUrl: url,
      retailerKey,
      retailerSku: object.retailerSku,
      title: object.title,
      brand: object.brand,
      description: object.description,
      categoryPath: object.categoryPath,
      gtin: object.gtin,
      mpn: object.mpn,
      price: object.price,
      listPrice: object.listPrice,
      currency: object.currency,
      availability: object.availability,
      stockQty: null,
      imageUrl: isUrl(object.imageUrl) ? object.imageUrl : null,
      attributes: object.attributes,
      capturedAt: new Date(),
    };
  } catch (err) {
    log.warn('llm extraction failed', { url, err: String(err) });
    return null;
  }
}

function condenseHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, header, footer, nav').remove();
  const meta = [
    $('h1').first().text(),
    $('meta[property="og:title"]').attr('content') ?? '',
    $('meta[property="product:price:amount"]').attr('content') ?? '',
    $('[class*="price"]').first().text(),
    $('[class*="brand"]').first().text(),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
  const body = $('main, [role="main"], body').first().text().replace(/\s+/g, ' ').trim();
  return `${meta}\n${body}`.slice(0, 6000);
}

function isUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
