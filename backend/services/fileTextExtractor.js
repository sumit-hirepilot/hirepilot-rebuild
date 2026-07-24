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
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }

  throw new Error(`Unsupported file type: ${ext || mimetype}. Please upload a .txt, .docx, or .pdf file, or paste your resume text directly.`);
}

module.exports = { extractTextFromFile };
