const mammoth = require('mammoth');

async function extractTextFromFile(buffer, mimetype, originalname) {
  const ext = (originalname.split('.').pop() || '').toLowerCase();

  if (mimetype === 'text/plain' || ext === 'txt' || ext === 'md') {
    return buffer.toString('utf8');
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype === 'application/pdf' || ext === 'pdf') {
    // pdf-parse (pdfjs-dist under the hood) depends on the @napi-rs/canvas
    // native addon even for plain text extraction, and its prebuilt binary
    // doesn't reliably load in Railway's container - it throws "DOMMatrix is
    // not defined" there despite working locally. unpdf ships a canvas-free
    // pdf.js build built for exactly this class of serverless/Docker
    // environment, so text extraction works the same everywhere.
    const { getDocumentProxy, extractText } = require('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }

  throw new Error(`Unsupported file type: ${ext || mimetype}. Please upload a .txt, .docx, or .pdf file, or paste your resume text directly.`);
}

module.exports = { extractTextFromFile };
