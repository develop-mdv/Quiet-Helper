/** Извлекает текст из PDF (pdf-parse v2 / pdfjs). Убирает служебные разделители страниц. */
export async function extractPdfText(buf: Buffer): Promise<string> {
  // Ленивый импорт: pdfjs тяжёлый, грузим только когда реально импортируют PDF.
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const res = await parser.getText()
    return res.text.replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gm, '').trim()
  } finally {
    await parser.destroy()
  }
}
